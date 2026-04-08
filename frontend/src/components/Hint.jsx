/**
 * Короткая метка с кружком «?»: при наведении показывается подсказка (title).
 * Для полей ввода основная подсказка дублируется на самом input через title.
 */
export function Hint({ title }) {
  return (
    <span
      className="inline-flex items-center justify-center ml-1 w-4 h-4 rounded-full bg-slate-700 text-[10px] text-slate-300 cursor-help align-super transition-colors duration-200 hover:bg-indigo-600/40 hover:text-indigo-100"
      title={title}
      aria-label={title}
    >
      ?
    </span>
  )
}
