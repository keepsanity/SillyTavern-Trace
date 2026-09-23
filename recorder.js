export const STORAGE_KEY = 'generation_info';

const isContinuation = type => ['continue', 'append', 'appendFinal'].includes(type);
const isReply = message => message && !message.is_user && !message.is_system;
const text = value => typeof value === 'string' ? value : '';

/** Read only saved metadata; never infer old settings from today's preset. */
export function getRecords(message) {
    const saved = message?.extra?.[STORAGE_KEY];
    if (saved?.version === 1 && Array.isArray(saved.records) && saved.records.length) {
        return saved.records.map(record => ({
            model: text(record?.model), api: text(record?.api), preset: text(record?.preset),
        }));
    }
    return [{ model: text(message?.extra?.model), api: text(message?.extra?.api), preset: '' }];
}

/** Event-driven recorder, with injected context so persistence can be tested without a browser. */
export function createRecorder(getContext, getSettings) {
    let pending;
    let captureAllowed = false;

    function reset() {
        pending = undefined;
        captureAllowed = false;
    }

    function start(type, options = {}, dryRun = false) {
        captureAllowed = !dryRun && !['quiet', 'impersonate'].includes(type);
        if (!captureAllowed) return;
        const context = getContext();
        const previous = context.chat.at(-1);
        pending = {
            chat: context.chat,
            chatId: context.getCurrentChatId(),
            previous,
            previousText: previous?.mes,
            previousSwipeCount: previous?.swipe_info?.length ?? 0,
            previousRecords: isContinuation(type) && isReply(previous) ? getRecords(previous) : [],
            existing: new Set(context.chat),
            type,
            seen: new WeakSet(),
            snapshot: undefined,
        };
    }

    function capture(data, dryRun = false) {
        if (!pending || pending.snapshot || !captureAllowed || dryRun) return;
        const settings = getSettings();
        pending.snapshot = {
            model: text(settings.model), api: text(settings.api), preset: text(settings.preset),
        };
    }

    function receive(messageId, type) {
        const context = getContext();
        const message = context.chat[messageId];
        if (!pending?.snapshot || pending.chat !== context.chat
            || pending.chatId !== context.getCurrentChatId() || !isReply(message)
            || ['first_message', 'quiet', 'impersonate'].includes(type)
            || pending.seen.has(message)) return false;

        const continuing = isContinuation(pending.type);
        if (continuing || pending.type === 'swipe') {
            if (message !== pending.previous) return false;
            if (continuing && message.mes === pending.previousText) return false;
        } else if (pending.existing.has(message)) {
            return false;
        }

        const record = { ...pending.snapshot };
        // Horde selects the actual worker/model after dispatch.
        if (record.api === 'koboldhorde' && message.extra?.model) record.model = message.extra.model;
        const records = continuing ? [...pending.previousRecords, record] : [record];
        message.extra ??= {};
        message.extra[STORAGE_KEY] = { version: 1, records };

        // Streaming synchronizes swipe metadata BEFORE MESSAGE_RECEIVED; non-streaming does it after.
        const currentSwipe = message.swipe_id ?? 0;
        for (const [index, swipe] of (message.swipe_info ?? []).entries()) {
            const newAlternative = index >= (message === pending.previous ? pending.previousSwipeCount : 0);
            if (!swipe || (index !== currentSwipe && !newAlternative)) continue;
            swipe.extra ??= {};
            swipe.extra[STORAGE_KEY] = structuredClone(message.extra[STORAGE_KEY]);
        }
        pending.seen.add(message);
        reset();
        return true;
    }

    return { start, capture, receive, reset };
}
