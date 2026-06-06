'use client'
import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, AlertTriangle } from '../ui/icons'

export function GuidePanel({ title, steps, note }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-blue-200 rounded-xl bg-blue-50 mb-6">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium text-blue-700">{title}</span>
        </div>
        {open
          ? <ChevronUp size={14} className="text-blue-400" />
          : <ChevronDown size={14} className="text-blue-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-blue-200">
          <ol className="mt-3 space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-blue-800">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                <span dangerouslySetInnerHTML={{ __html: step }} />
              </li>
            ))}
          </ol>
          {note && (
            <div className="mt-3 flex gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">{note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
