import { getGeneratingApi, getGeneratingModel } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { createRecorder, getRecords } from './recorder.js';

const BUTTON_CLASS = 'generation-info-button';
const context = getContext();
const { eventSource, eventTypes } = context;
const recorder = createRecorder(getContext, () => ({
    model: getGeneratingModel(),
    api: getGeneratingApi(),
    preset: getContext().getPresetManager()?.getSelectedPresetName() || '',
}));

function createButton() {
    // Match native message actions so toolbar/theme spacing applies consistently.
    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    button.className = `mes_button ${BUTTON_CLASS} fa-solid fa-circle-info`;
    button.title = '생성 정보 · 모델 / API / 프리셋';
    button.setAttribute('aria-label', button.title);
    return button;
}

function addButtons() {
    // Including the message template makes subsequent renders work without observing streamed text.
    document.querySelectorAll('#message_template .extraMesButtons, #chat .mes .extraMesButtons').forEach(actions => {
        if (!actions.querySelector(`.${BUTTON_CLASS}`)) actions.prepend(createButton());
    });
}

function showInfo(messageId) {
    const message = getContext().chat[messageId];
    if (!message || message.is_user || message.is_system) return;
    const content = document.createElement('div');
    content.className = 'generation-info-details';
    const records = getRecords(message);
    records.forEach((record, index) => {
        if (records.length > 1) {
            const heading = document.createElement('h4');
            heading.textContent = index === 0 ? '처음 생성' : `이어쓰기 ${index}`;
            content.append(heading);
        }
        const list = document.createElement('dl');
        for (const [label, value] of [['모델', record.model], ['API', record.api], ['프리셋', record.preset]]) {
            const term = document.createElement('dt');
            const description = document.createElement('dd');
            term.textContent = label;
            description.textContent = value || '기록 없음';
            list.append(term, description);
        }
        content.append(list);
    });
    void getContext().Popup.show.text('생성 정보', content.outerHTML);
}

eventSource.on(eventTypes.GENERATION_STARTED, recorder.start);
eventSource.makeLast(eventTypes.GENERATE_AFTER_DATA, recorder.capture);
eventSource.makeFirst(eventTypes.MESSAGE_RECEIVED, recorder.receive);
eventSource.on(eventTypes.CHAT_CHANGED, () => {
    recorder.reset();
    addButtons();
});
for (const event of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.MORE_MESSAGES_LOADED, eventTypes.MESSAGE_SWIPED]) {
    eventSource.on(event, addButtons);
}

$(document).on('click.generationInfo', `#chat .${BUTTON_CLASS}`, function (event) {
    event.preventDefault();
    event.stopPropagation();
    showInfo(Number(this.closest('.mes')?.getAttribute('mesid')));
});

$(document).on('keydown.generationInfo', `#chat .${BUTTON_CLASS}`, function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        this.click();
    }
});

addButtons();
