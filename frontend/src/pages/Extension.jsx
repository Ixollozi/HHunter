import { Link } from 'react-router-dom'
import extensionReadme from '../../../hhunter-extension/README.md?raw'
import { apiBaseUrl } from '../lib/api'
import { Hint } from '../components/Hint'

function UtcTodayHint() {
  return (
    <span className="text-slate-500">
      Лимит откликов на бэкенде считается по суткам UTC (как при сохранении через расширение).
    </span>
  )
}

export default function Extension() {
  const apiUrl = apiBaseUrl
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1:5173'

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Расширение HHunter для Chrome
          <Hint title="На hh.ru расширение собирает текст вакансии и запрашивает сопроводительное письмо у вашего бэкенда (Groq). Отклик и вставка текста идут в браузере; сервер хранит ключ API, модель, резюме и учёт откликов." />
        </h1>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          Установите расширение из папки <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code>
          , запустите бэкенд и этот сайт, войдите в аккаунт. В popup укажите тот же <strong className="text-slate-300">URL API</strong>, что
          и в <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">VITE_API_BASE</code>, и вставьте <strong className="text-slate-300">JWT</strong>
          : значение <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter_token</code> из{' '}
          <span className="text-slate-300">DevTools → Application → Local Storage</span> на вкладке HHunter (кнопка{' '}
          <span className="text-slate-300">Сохранить</span> в popup). Дальше откройте страницу вакансии на hh.ru и запустите цикл.{' '}
          <UtcTodayHint />
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Сервер</h2>
        <p className="text-slate-300 text-sm leading-relaxed">
          Из корня репозитория, с активированным <code className="text-indigo-300">.venv</code> и настроенным{' '}
          <code className="text-indigo-300">backend/.env</code> (в т.ч. секрет шифрования ключа Groq и параметры БД), обычно
          достаточно:
        </p>
        <pre className="text-sm text-slate-200 bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 overflow-x-auto">
          python start.py --migrate
        </pre>
        <p className="text-slate-400 text-sm leading-relaxed">
          По умолчанию поднимаются API без <code className="text-indigo-300">--reload</code> и фронт через{' '}
          <code className="text-indigo-300">vite preview</code> на порту <code className="text-indigo-300">5173</code>. Режим с
          горячей перезагрузкой: <code className="text-indigo-300">python start.py --dev --migrate</code>.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Установка расширения (режим разработчика)</h2>
        <ol className="list-decimal list-inside text-slate-300 text-sm space-y-2 leading-relaxed">
          <li>
            Возьмите папку <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> из корня
            репозитория.
          </li>
          <li>
            Откройте <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">chrome://extensions</code>, включите{' '}
            «Режим разработчика».
          </li>
          <li>
            «Загрузить распакованное расширение» → укажите эту папку. После обновления файлов в репозитории нажмите «Обновить»
            у карточки расширения.
          </li>
          <li>
            В popup: <strong className="text-slate-200">API base</strong> —{' '}
            <code className="text-indigo-300">{apiUrl}</code> (или ваш прод-хост), совпадающий с{' '}
            <code className="text-indigo-300">VITE_API_BASE</code> при сборке фронта.
          </li>
          <li>
            В popup: <strong className="text-slate-200">JWT token</strong> — строка из{' '}
            <code className="text-indigo-300">hhunter_token</code> после входа на сайт; затем «Сохранить». Для ручной
            проверки API можно использовать страницу{' '}
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/settings">
              Настройки
            </Link>{' '}
            (тест Groq и лимиты).
          </li>
          <li>
            В <code className="text-indigo-300">manifest.json</code> в{' '}
            <code className="text-indigo-300">host_permissions</code> для локальной разработки уже перечислены{' '}
            <code className="text-indigo-300">localhost</code>/<code className="text-indigo-300">127.0.0.1</code> для портов{' '}
            <code className="text-indigo-300">5173</code> и <code className="text-indigo-300">8000</code>. Для своего домена
            добавьте строки с <code className="text-indigo-300">https://ваш-домен/*</code>.
          </li>
        </ol>
        <p className="text-slate-500 text-xs leading-relaxed">
          Текущий origin этой вкладки: <code className="text-slate-400">{origin}</code> — при другом порте или хосте добавьте его в
          манифест.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Что настроить до работы на hh.ru</h2>
        <ul className="text-slate-300 text-sm space-y-2 list-disc list-inside leading-relaxed">
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/settings">
              Настройки
            </Link>
            : ключ Groq (хранится на сервере в зашифрованном виде), выбор модели, текст резюме для промпта.
          </li>
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/search">
              Параметры поиска
            </Link>
            : дневной лимит откликов и паузы между шагами — расширение читает их через API.
          </li>
          <li>
            В popup после «Сохранить» строка с моделью и «ключ OK» приходит с <code className="text-indigo-300">/extension/settings</code>
            . Ошибки <code className="text-indigo-300">429</code> от Groq — временные лимиты; статистика и последнее сообщение
            видны в том же блоке.
          </li>
          <li>
            Устранение неполадок: <strong className="text-slate-200">«Протестировать приложение»</strong> в нижней панели.
            Галочка «Сгенерировать демо-письмо» добавляет один вызов Groq; без неё проверка не тратит квоту модели.
          </li>
        </ul>
      </section>

      <details
        open
        className="rounded-2xl border border-slate-800 bg-slate-900/30 group"
      >
        <summary className="cursor-pointer list-none px-5 py-4 text-lg font-medium text-slate-100 [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2">
          <span>Документация расширения (README)</span>
          <span className="text-xs font-normal text-slate-500 group-open:hidden">развернуть</span>
          <span className="text-xs font-normal text-slate-500 hidden group-open:inline">свернуть</span>
        </summary>
        <div className="px-5 pb-5 border-t border-slate-800/90">
          <p className="text-xs text-slate-500 mt-3 mb-3">
            Файл в репозитории: <code className="text-slate-400">hhunter-extension/README.md</code>
          </p>
          <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
            {extensionReadme}
          </pre>
        </div>
      </details>
    </div>
  )
}
