/** Единые стили наведения + фокуса для полей и кнопок (подсказка — через атрибут title). */

const fieldCore =
  'rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 transition-all duration-200 ' +
  'hover:border-indigo-500/45 hover:bg-slate-800/50 hover:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)] ' +
  'focus:border-indigo-500/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/25'

/** Поле на всю ширину контейнера */
export const field = `${fieldCore} w-full`

/** Поле без принудительной ширины (кнопки в сетке, select). */
export const fieldInline = fieldCore

export const btnPrimary =
  'rounded-xl px-4 py-2 font-medium transition-all duration-200 ' +
  'hover:brightness-110 hover:shadow-lg hover:shadow-indigo-500/10 active:scale-[0.98] ' +
  'disabled:opacity-60 disabled:hover:brightness-100 disabled:active:scale-100 disabled:hover:shadow-none'

export const btnNeutral =
  'rounded-xl px-3 py-2 text-sm transition-all duration-200 ' +
  'hover:bg-slate-700 hover:shadow-md active:scale-[0.98]'

export const navLink =
  'px-3 py-2 rounded-lg text-sm transition-all duration-200 ' +
  'hover:bg-slate-800/90 hover:text-white hover:ring-1 hover:ring-slate-600/50'

export const link =
  'text-indigo-400 hover:text-indigo-300 transition-colors duration-200 hover:underline underline-offset-2'
