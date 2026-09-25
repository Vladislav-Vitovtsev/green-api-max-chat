import type { ApiErrorKind } from '../api/errors'
import { MAX_MESSAGE_LENGTH } from '../core/limits'

export const texts = {
  appTitle: 'MAX · GREEN-API',
  login: {
    title: 'Вход через GREEN-API',
    subtitle: 'Данные инстанса есть в личном кабинете GREEN-API',
    idInstance: 'idInstance',
    apiToken: 'apiTokenInstance',
    apiUrl: 'apiUrl',
    apiUrlHint: 'Хост из карточки инстанса в консоли, например https://1103.api.green-api.com',
    remember: 'Запомнить меня на этом устройстве',
    submit: 'Войти',
    where: 'Где взять данные',
    show: 'Показать токен',
    hide: 'Скрыть токен',
  },
  chats: {
    title: 'Чаты',
    search: 'Найти',
    newChat: 'Новый чат',
    empty: 'Чатов пока нет. Нажмите «+», чтобы написать по номеру',
    nothingFound: 'Ничего не найдено',
    logout: 'Выйти',
    writeTo: (phone: string) => `Написать ${phone}`,
  },
  newChat: {
    title: 'Новый чат',
    phone: 'Номер телефона',
    placeholder: '+7 999 123-45-67',
    submit: 'Создать чат',
    cancel: 'Отмена',
    limit: 'MAX временно ограничил проверку номеров, попробуйте позже',
  },
  chat: {
    selectPrompt: 'Выберите чат или создайте новый',
    noMessages: 'Сообщений пока нет',
    placeholder: 'Сообщение',
    send: 'Отправить',
    retry: 'Повторить',
    back: 'Назад',
    historyFailed: 'Не удалось загрузить историю',
    today: 'Сегодня',
    yesterday: 'Вчера',
    tooLong: (n: number) => `Слишком длинное сообщение: ${n} из ${MAX_MESSAGE_LENGTH}`,
    you: 'Вы: ',
    quoteFromMe: 'Вы',
    deleted: 'Сообщение удалено',
    edited: 'ред.',
    unreadAria: (n: number) => `${n} непрочитанных`,
  },
  banner: {
    notAuthorized: 'Инстанс не авторизован: отсканируйте QR-код в консоли GREEN-API',
    quota: 'Исчерпан лимит тарифа Developer: новые чаты недоступны',
    offline: 'Нет соединения, переподключаемся…',
    openConsole: 'Открыть консоль',
  },
  status: {
    pending: 'Отправляется',
    sent: 'Отправлено',
    delivered: 'Доставлено',
    read: 'Прочитано',
    failed: 'Не отправлено',
  },
  nav: {
    label: 'Навигация',
  },
  otherTab: {
    title: 'Приложение открыто в другой вкладке',
    hint: 'Приложение работает в одной вкладке. Если продолжить здесь, в другой вкладке оно остановится',
    takeOver: 'Работать здесь',
  },
  fatal: { title: 'Что-то пошло не так', reload: 'Перезагрузить' },
}

const ERRORS: Record<ApiErrorKind | 'empty' | 'format' | 'country' | 'noAccount', string> = {
  unauthorized: 'Неверный idInstance или apiTokenInstance',
  notAuthorized: 'Инстанс не авторизован: отсканируйте QR-код в консоли GREEN-API',
  rateLimit: 'Слишком часто. Попробуйте через пару секунд',
  quota: 'Исчерпан лимит тарифа Developer',
  network: 'Нет соединения с GREEN-API. Проверьте apiUrl и интернет',
  validation: 'Сервер не принял данные. Проверьте введённые значения',
  unknown: 'Неизвестная ошибка. Попробуйте ещё раз',
  empty: 'Введите номер телефона',
  format: 'Похоже, это не номер телефона',
  country: 'Поддерживаются номера России (+7) и Беларуси (+375)',
  noAccount: 'У этого номера нет MAX',
}

export function errorText(kind: keyof typeof ERRORS): string {
  return ERRORS[kind]
}
