'use client'
import { useState } from 'react'
import { Info } from '../ui/icons'

export function HelpTooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex items-center ml-1">
      <button type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-gray-400 hover:text-blue-500 transition-colors">
        <Info size={13} strokeWidth={2} />
      </button>
      {show && (
        <div className="absolute z-50 left-5 top-0 w-56 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
          {text}
          <div className="absolute left-0 top-2 -translate-x-1.5 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </span>
  )
}
