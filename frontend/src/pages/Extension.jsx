import { Link } from 'react-router-dom'
import extensionReadme from '../../../hhunter-extension/README.md?raw'
import { apiBaseUrl } from '../lib/api'
import { Hint } from '../components/Hint'

function UtcTodayHint() {
  return (
    <span className="text-slate-500">
      Дневной лимит откликов на сервере считается по суткам по времени UTC (как в календаре сервера).
    </span>
  )
}

export default function Extension() {
  const apiUrl = apiBaseUrl.replace(/\/$/, '')
  const extensionZipUrl = `${apiUrl}/downloads/hhunter-extension.zip`
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1:5173'

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2 flex-wrap">
          Расширение HHunter для Chrome
          <Hint title="На сайте вакансии hh.ru расширение подставляет текст вакансии, запрашивает у вашего HHunter черновик письма и помогает отправить отклик. Секретные ключи и резюме хранятся на сервере HHunter, не в расширении." />
        </h1>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          Расширение связывает браузер с вашим сайтом HHunter. Его обычно ставят один раз: откройте эту страницу,
          войдите в аккаунт, <strong className="text-slate-300">скачайте архив расширения</strong> (кнопка ниже) или
          возьмите папку <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> из
          комплекта поставки. Затем в окошке расширения укажите{' '}
          <strong className="text-slate-300">тот же адрес сервера HHunter</strong>, что вы используете в браузере, и{' '}
          <strong className="text-slate-300">код входа</strong> (удобнее — «Взять код с
          открытой вкладки HHunter»). После этого откройте вакансию на hh.ru и нажмите «Запустить». <UtcTodayHint />
        </p>
      </div>

      <section className="rounded-2xl border border-emerald-900/50 bg-emerald-950/15 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Скачать расширение</h2>
        <p className="text-slate-300 text-sm leading-relaxed">
          Архив в формате ZIP собирается с этого сервера. Сохраните файл, <strong className="text-slate-200">распакуйте</strong>{' '}
          (в Проводнике Windows: правый клик → «Извлечь всё…»), затем в Chrome укажите{' '}
          <strong className="text-slate-200">папку</strong> <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> из распакованного содержимого — не сам ZIP-файл.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={extensionZipUrl}
            download
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            Скачать hhunter-extension.zip
          </a>
          <span className="text-xs text-slate-500 break-all max-w-full">
            Прямая ссылка: <code className="text-slate-400">{extensionZipUrl}</code>
          </span>
        </div>
        <p className="text-slate-500 text-xs leading-relaxed">
          Если скачивание не начинается, проверьте, что сервер HHunter запущен и в настройках браузера не блокируются
          загрузки с адреса API.
        </p>
      </section>

      <section className="rounded-2xl border border-amber-900/45 bg-amber-950/10 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Ключ Groq: зачем, где взять, куда вставить</h2>
        <p className="text-slate-300 text-sm leading-relaxed">
          Генерация сопроводительного письма идёт на сервере HHunter через API{' '}
          <a
            href="https://groq.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-200/95 hover:text-amber-100 underline-offset-2 hover:underline"
          >
            Groq
          </a>
          . У <strong className="text-slate-200">каждого пользователя HHunter свой ключ</strong>: он хранится в вашей
          записи на сервере (зашифрованно), расширение его не видит и не отправляет на hh.ru. Чужой ключ подставить
          нельзя — запросы к модели идут только с тем ключом, который вы сохранили в{' '}
          <Link className="text-amber-200/95 hover:text-amber-100 underline-offset-2 hover:underline" to="/settings">
            Настройках
          </Link>{' '}
          под своим логином.
        </p>
        <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-4 space-y-2">
          <h3 className="text-sm font-medium text-slate-200">Как получить API key</h3>
          <ol className="list-decimal list-inside text-slate-300 text-sm space-y-2 leading-relaxed marker:text-slate-500">
            <li>
              Зарегистрируйтесь или войдите на{' '}
              <a
                href="https://console.groq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-200/95 hover:text-amber-100 underline-offset-2 hover:underline"
              >
                console.groq.com
              </a>
              .
            </li>
            <li>
              Откройте раздел{' '}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-200/95 hover:text-amber-100 underline-offset-2 hover:underline"
              >
                API Keys
              </a>{' '}
              и создайте ключ (Create API key). Скопируйте строку вида <code className="text-slate-400">gsk_…</code>.
            </li>
            <li>
              На сайте HHunter:{' '}
              <Link className="text-amber-200/95 hover:text-amber-100 underline-offset-2 hover:underline" to="/settings">
                Настройки
              </Link>{' '}
              → вставьте ключ в поле Groq → при желании выберите модель → сохраните. Проверку можно сделать кнопкой
              теста или нижней панелью «Протестировать приложение».
            </li>
          </ol>
        </div>
        <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-4 space-y-2">
          <h3 className="text-sm font-medium text-slate-200">Аккаунт на HeadHunter (hh.ru и др.)</h3>
          <p className="text-slate-300 text-sm leading-relaxed">
            Расширение открывает страницы hh <strong className="text-slate-200">в вашем Chrome</strong>. Отклики и просмотр
            вакансий идут от той учётной записи hh.ru, под которой вы <strong className="text-slate-200">уже вошли в этом
            браузере</strong> (куки и сессия сайта). HHunter не может «подменить» чужой логин на hh: если в профиле Chrome
            залогинен другой человек, используйте отдельный профиль Chrome или выйдите с его hh перед работой.
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">
            Код входа в окне расширения должен быть <strong className="text-slate-300">вашим</strong> (кнопка с вкладки,
            где вы вошли в HHunter). Если вставить чужой код, запросы пойдут в <strong className="text-slate-300">другой
            аккаунт HHunter</strong> — с чужим ключом Groq и историей откликов, при этом hh.ru по-прежнему останется тем,
            кто залогинен в браузере.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Установка за несколько шагов</h2>
        <ol className="list-decimal list-inside text-slate-300 text-sm space-y-3 leading-relaxed marker:text-slate-500">
          <li>
            <strong className="text-slate-200">Запустите HHunter в браузере</strong> — откройте этот сайт, как обычно (адрес
            вам дал администратор или вы сами подняли сервер). Войдите в личный кабинет и при необходимости укажите ключ
            Groq в <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/settings">Настройках</Link>{' '}
            (см. блок «Ключ Groq» выше).
          </li>
          <li>
            <strong className="text-slate-200">Подготовьте папку расширения</strong> — либо скачайте и распакуйте архив из
            блока «Скачать расширение» выше, либо скопируйте папку{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> из архива с исходным
            кодом HHunter. Нужна именно папка, внутри которой лежит файл{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">manifest.json</code> (если после распаковки
            получилось «hhunter-extension/hhunter-extension» — выбирайте внутреннюю папку с этим файлом).
          </li>
          <li>
            <strong className="text-slate-200">Откройте страницу расширений Chrome</strong> — в адресной строке введите{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">chrome://extensions</code> и нажмите Enter.
          </li>
          <li>
            <strong className="text-slate-200">Включите «Режим разработчика»</strong> — переключатель справа сверху на той
            же странице.
          </li>
          <li>
            <strong className="text-slate-200">Нажмите «Загрузить распакованное расширение»</strong> и укажите папку{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">hhunter-extension</code> с{' '}
            <code className="text-indigo-300 bg-slate-800/80 px-1 rounded">manifest.json</code> (не ZIP-архив и не отдельные
            файлы по одному). В списке появится «HHunter».
          </li>
          <li>
            <strong className="text-slate-200">Закрепите иконку</strong> — нажмите на пазл рядом с адресной строкой,
            найдите HHunter и закрепите, чтобы ярлык был всегда под рукой.
          </li>
          <li>
            <strong className="text-slate-200">Подключите расширение к сайту</strong> — кликните по иконке HHunter. В поле{' '}
            <strong className="text-slate-200">«Адрес сайта HHunter»</strong> вставьте адрес сервера (см. блок ниже).
            Нажмите <strong className="text-slate-200">«Взять код с открытой вкладки HHunter»</strong> (вкладка с этим
            сайтом должна быть открыта и вы должны быть вошли), затем{' '}
            <strong className="text-slate-200">«Сохранить настройки»</strong>.
          </li>
          <li>
            <strong className="text-slate-200">Проверьте строку «Сейчас»</strong> внизу окна расширения: если связь с
            сервером есть, появятся лимиты и модель. Если красным или пусто — проверьте адрес и что сайт HHunter открыт.
          </li>
          <li>
            <strong className="text-slate-200">Работа на hh.ru</strong> — откройте страницу вакансии, нажмите в расширении{' '}
            <strong className="text-slate-200">«Запустить»</strong>. Режим «сам открывать поиск» включайте только если вам
            так настроили поток откликов.
          </li>
        </ol>
      </section>

      <section className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-5 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Адрес сервера для расширения</h2>
        <p className="text-slate-300 text-sm leading-relaxed">
          Скопируйте это значение в поле «Адрес сайта HHunter» в окне расширения (должно совпадать с тем, как вы открываете
          API HHunter в браузере; обычно это тот же хост, что и у этой страницы, но порт{' '}
          <strong className="text-slate-200">8000</strong>, если сайт на 5173, а API на 8000).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-sm text-indigo-200 bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 break-all">
            {apiUrl}
          </code>
          <button
            type="button"
            className="text-xs font-medium text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
            onClick={() => void navigator.clipboard?.writeText(apiUrl)}
          >
            Копировать
          </button>
        </div>
        <p className="text-slate-500 text-xs leading-relaxed">
          Если вы заходите на HHunter по другому адресу (другой компьютер или интернет-адрес), вставьте тот адрес, который
          дал администратор — тот же, под которым работает программа на сервере.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
        <h2 className="text-lg font-medium text-slate-100">Перед откликами на hh.ru</h2>
        <ul className="text-slate-300 text-sm space-y-2 list-disc list-inside leading-relaxed marker:text-slate-500">
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/settings">
              Настройки
            </Link>
            — ключ для генерации писем, модель, текст резюме (это настраивает тот, у кого есть доступ к серверу).
          </li>
          <li>
            <Link className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline" to="/search">
              Параметры поиска
            </Link>
            — сколько откликов в день и паузы; расширение подхватывает их автоматически.
          </li>
          <li>
            Если отклики не уходят, откройте нижнюю панель HHunter и используйте{' '}
            <strong className="text-slate-200">«Протестировать приложение»</strong> — так проще понять, где сбой (сайт,
            сервер или расширение).
          </li>
        </ul>
      </section>

      <details className="rounded-2xl border border-slate-800 bg-slate-900/30 group">
        <summary className="cursor-pointer list-none px-5 py-4 text-base font-medium text-slate-200 [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2">
          <span>Если вы сами запускаете HHunter на компьютере (для разработчиков)</span>
          <span className="text-xs font-normal text-slate-500 group-open:hidden">развернуть</span>
          <span className="text-xs font-normal text-slate-500 hidden group-open:inline">свернуть</span>
        </summary>
        <div className="px-5 pb-5 pt-0 space-y-4 border-t border-slate-800/90">
          <div>
            <h3 className="text-sm font-medium text-slate-200 mb-2">Сервер и сайт</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-2">
              Из корня репозитория, с виртуальным окружением и файлом{' '}
              <code className="text-indigo-300">backend/.env</code>, обычно достаточно:
            </p>
            <pre className="text-sm text-slate-200 bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 overflow-x-auto">
              python start.py --migrate
            </pre>
            <p className="text-slate-500 text-sm leading-relaxed mt-2">
              Для пользователей Windows есть “установщик в один клик”:{' '}
              <code className="text-indigo-300">HHunter-Setup.cmd</code> — он поставит Python/Node (через winget, если нужно),
              создаст <code className="text-indigo-300">.venv</code>, установит зависимости и запустит проект.
            </p>
            <p className="text-slate-500 text-sm leading-relaxed mt-2">
              Режим с перезагрузкой при правках:{' '}
              <code className="text-indigo-300">python start.py --dev --migrate</code>. Фронт по умолчанию на порту{' '}
              <code className="text-indigo-300">5173</code>, API — укажите в переменной окружения{' '}
              <code className="text-indigo-300">VITE_API_BASE</code> при сборке, чтобы он совпадал с тем, что вводится в
              расширении.
            </p>
            <p className="text-slate-500 text-sm leading-relaxed mt-2">
              Архив для пользователей отдаётся с API:{' '}
              <code className="text-indigo-300">GET /downloads/hhunter-extension.zip</code> (на странице «Расширение» —
              кнопка скачивания). При деплое рядом с каталогом <code className="text-indigo-300">backend</code> должна
              лежать папка <code className="text-indigo-300">hhunter-extension</code>, иначе ответ будет 404.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-200 mb-2">Доступ расширения к вашему домену</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              В <code className="text-indigo-300">hhunter-extension/manifest.json</code> в{' '}
              <code className="text-indigo-300">host_permissions</code> для локальной работы уже указаны{' '}
              <code className="text-indigo-300">localhost</code> и <code className="text-indigo-300">127.0.0.1</code> для
              портов <code className="text-indigo-300">5173</code> и <code className="text-indigo-300">8000</code>. Для
              своего HTTPS-домена добавьте строку вида <code className="text-indigo-300">https://ваш-домен/*</code>.
            </p>
            <p className="text-slate-500 text-xs leading-relaxed mt-2">
              Текущий origin этой вкладки: <code className="text-slate-400">{origin}</code> — при другом хосте или порте
              добавьте его в манифест и перезагрузите расширение.
            </p>
          </div>
          <p className="text-slate-500 text-xs leading-relaxed">
            Код входа вручную можно взять из инструментов разработчика: вкладка HHunter → Application → Local Storage →
            ключ <code className="text-slate-400">hhunter_token</code> — но для пользователей проще кнопка в расширении.
          </p>
        </div>
      </details>

      <details className="rounded-2xl border border-slate-800 bg-slate-900/30 group">
        <summary className="cursor-pointer list-none px-5 py-4 text-lg font-medium text-slate-100 [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2">
          <span>Текстовая инструкция из репозитория (README)</span>
          <span className="text-xs font-normal text-slate-500 group-open:hidden">развернуть</span>
          <span className="text-xs font-normal text-slate-500 hidden group-open:inline">свернуть</span>
        </summary>
        <div className="px-5 pb-5 border-t border-slate-800/90">
          <p className="text-xs text-slate-500 mt-3 mb-3">
            Файл: <code className="text-slate-400">hhunter-extension/README.md</code>
          </p>
          <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
            {extensionReadme}
          </pre>
        </div>
      </details>
    </div>
  )
}
