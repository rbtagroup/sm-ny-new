import { defaultShiftTemplates, defaultShiftTimes, shiftTypeMap } from './appConfig.js'

export function configuredShiftTimes(settings = {}) {
  return { ...defaultShiftTimes, ...(settings.shiftTimes || {}) }
}

export function inferShiftTemplateType(template = {}) {
  const name = String(template.name || '').toLowerCase()
  if (template.type && shiftTypeMap[template.type]) return template.type
  if (name.includes('noč')) return 'night'
  if (name.includes('den')) return 'day'
  return 'custom'
}

export function normalizeShiftTemplates(settings = {}) {
  const legacy = configuredShiftTimes(settings)
  const source = Array.isArray(settings.shiftTemplates) && settings.shiftTemplates.length
    ? settings.shiftTemplates
    : [
      { ...defaultShiftTemplates[0], start: legacy.dayStart, end: legacy.dayEnd },
      { ...defaultShiftTemplates[1], start: legacy.nightStart, end: legacy.nightEnd },
    ]
  return source.map((tpl, index) => ({
    id: tpl.id || `tpl_${index + 1}`,
    name: String(tpl.name || `Šablona ${index + 1}`).trim(),
    start: String(tpl.start || '07:00').slice(0, 5),
    end: String(tpl.end || '19:00').slice(0, 5),
    active: tpl.active !== false,
    type: inferShiftTemplateType(tpl),
  }))
}

export function shiftTemplateOptions(settings = {}) {
  const activeTemplates = normalizeShiftTemplates(settings).filter((tpl) => tpl.active)
  return {
    custom: 'Vlastní čas',
    ...Object.fromEntries(activeTemplates.map((tpl) => [tpl.id, `${tpl.name} ${tpl.start}–${tpl.end}`])),
  }
}

export function shiftTemplateValue(key, settings = {}) {
  const template = normalizeShiftTemplates(settings).find((tpl) => tpl.id === key && tpl.active)
  if (!template) return null
  return { start: template.start, end: template.end, type: template.type || 'custom' }
}
