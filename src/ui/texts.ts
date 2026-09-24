import type { ApiErrorKind } from '../api/errors'

export const texts = {
  appTitle: 'MAX · GREEN-API',
  login: {
    title: 'Вход через GREEN-API',
    subtitle: 'Данные инстанса есть в личном кабинете GREEN-API',
    idInstance: 'idInstance',
    apiToken: 'apiTokenInstance',
    apiUrl: 'apiUrl',
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
    tooLong: (n: number) => `Слишком длинное сообщение: ${n} из 4000`,
  },
  banner: {
    otherTab: 'Приём сообщений идёт в другой вкладке',
    notAuthorized: 'Инстанс не авторизован: отсканируйте QR-код в консоли GREEN-API',
    quota: 'Исчерпан лимит тарифа Developer: новые чаты недоступны',
    offline: 'Нет соединения, переподключаемся…',
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
