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

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Расширение HHunter для Chrome
          <Hint title="Отклики на вакансии выполняются в браузере на hh.ru; сервер только генерирует письма и ведёт учёт." />
        </h1>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          Установите расширение, войдите на этот сайт в том же браузере (токен `hhunter_token` в localStorage), затем
          откликайтесь через браузер на сайте вакансий. <UtcTodayHint />
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Установка (режим разработчика)</h2>
        <ol className="list-decimal list-inside text-slate-300 text-sm space-y-2 leading-relaxed">
          <li>
            Скопируйте папку <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> из
            корня репозитория JHunter (или распакуйте архив с расширением).
          </li>
          <li>
            Откройте в Chrome:{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">chrome://extensions</code>
          </li>
          <li>Включите «Режим разработчика» (Developer mode).</li>
          <li>Нажмите «Загрузить распакованное расширение» (Load unpacked) и выберите папку.</li>
          <li>
            Откройте popup расширения → укажите URL API бэкенда (по умолчанию для разработки:{' '}
            <code className="text-indigo-300">{apiUrl}</code>
            ), совпадающий с <code className="text-indigo-300">VITE_API_BASE</code> фронта.
          </li>
          <li>
            Убедитесь, что в <code className="text-indigo-300">manifest.json</code> в{' '}
            <code className="text-indigo-300">host_permissions</code> есть ваш origin фронта (например{' '}
            <code className="text-indigo-300">http://localhost:5173/*</code>
            ) и URL API — иначе чтение токена и запросы к API будут заблокированы.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Что нужно до старта</h2>
        <ul className="text-slate-300 text-sm space-y-2 list-disc list-inside">
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/search">
              Параметры поиска
            </Link>{' '}
            (лимит и паузы используются расширением).
          </li>
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/settings">
              Настройки
            </Link>
            : ключ Gemini и текст резюме.
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
