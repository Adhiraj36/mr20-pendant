// The timetable's reading of a schedule, without a DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describe, durationMinutes, nextIn, parseCron, parseTrigger, scheduleOf } from '../src/routes/loops/schedule.js'

const sunday = new Date('2026-09-13T10:00:00')
const monday = new Date('2026-09-14T10:00:00')

test('a daily time reads as the time', () => {
  const s = parseCron('0 30 8 * * *', monday)
  assert.deepEqual(s, { kind: 'times', minutes: [510], today: true, days: '' })
  assert.equal(describe(s), 'Every day at 08:30')
})

test('an hour range reads as hourly between its ends', () => {
  assert.equal(describe(parseCron('0 0 18-22 * * *', monday)), 'Hourly from 18:00 to 22:00')
})

test('a day of the week is named, and knows whether it is today', () => {
  assert.equal(describe(parseCron('0 0 3 * * 0', sunday)), 'Sundays at 03:00')
  assert.equal((parseCron('0 0 3 * * 0', sunday) as { today: boolean }).today, true)
  assert.equal((parseCron('0 0 3 * * 0', monday) as { today: boolean }).today, false)
  assert.equal(describe(parseCron('0 0 9,21 * * 1-5', monday)), 'Weekdays at 09:00 and 21:00')
})

test('a step across the whole day reads as an interval', () => {
  assert.equal(describe(parseCron('0 */15 * * * *', monday)), 'Every 15 minutes')
  assert.equal(describe(parseCron('*/30 * * * *', monday)), 'Every 30 minutes')
})

test('the engine words around a schedule do not get in the way', () => {
  assert.deepEqual(parseTrigger('schedule @every 30m'), { kind: 'every', minutes: 30 })
  assert.equal(describe(parseTrigger('cron: 0 30 8 * * *', monday)), 'Every day at 08:30')
  assert.equal(describe(parseTrigger('@hourly')), 'Every hour')
})

test('an event stays an event, and nonsense is never drawn as a time', () => {
  assert.deepEqual(parseTrigger('event whatsapp.message'), { kind: 'event', text: 'event whatsapp.message' })
  assert.equal(describe(parseTrigger('event whatsapp.message')), 'On whatsapp.message')
  assert.equal(parseCron('0 99 8 * * *').kind, 'unknown')
})

test('durations are read the way the engine writes them', () => {
  assert.equal(durationMinutes('1h30m'), 90)
  assert.equal(durationMinutes('45s'), 0.75)
  assert.equal(durationMinutes('2 hours'), null)
  assert.deepEqual(scheduleOf('', '2h'), { kind: 'every', minutes: 120 })
})

test('the next run is counted from now, wrapping to tomorrow', () => {
  const s = parseCron('0 30 8 * * *', monday)
  assert.equal(nextIn(s, 8 * 60), 30)
  assert.equal(nextIn(s, 9 * 60), 1440 - 30)
  assert.equal(nextIn({ kind: 'event', text: 'x' }, 0), Number.POSITIVE_INFINITY)
})

test('registry names read as titles, and needs as services', async () => {
  const { serviceOf, titleOf } = await import('../src/routes/loops/names.js')
  assert.equal(titleOf('wa-monitor'), 'WhatsApp monitor')
  assert.equal(titleOf('hn-digest'), 'HN digest')
  assert.equal(titleOf('daily-post'), 'Daily post')
  assert.equal(serviceOf('whatsapp.monitored'), 'WhatsApp')
  assert.equal(serviceOf('whatsapp_search_messages'), 'WhatsApp')
  assert.equal(serviceOf('google_workspace'), 'Google Workspace')
  assert.equal(serviceOf('x.post'), 'X')
})
