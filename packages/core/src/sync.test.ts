import { describe, expect, test } from 'bun:test'
import {
  hlcCompare,
  hlcFromString,
  hlcToString,
  nextHlc,
  receiveHlc,
  shouldApply,
  mergeProgress,
  contentKey,
  episodeKey,
  progressKey,
} from './sync'

describe('sync HLC', () => {
  test('hlcCompare orders by wall, counter, device', () => {
    expect(hlcCompare({ wall: 1, counter: 0, device: 'a' }, { wall: 2, counter: 0, device: 'a' })).toBeLessThan(0)
    expect(hlcCompare({ wall: 2, counter: 0, device: 'a' }, { wall: 2, counter: 1, device: 'a' })).toBeLessThan(0)
    expect(hlcCompare({ wall: 2, counter: 1, device: 'a' }, { wall: 2, counter: 1, device: 'b' })).toBeLessThan(0)
    expect(hlcCompare({ wall: 2, counter: 1, device: 'a' }, { wall: 2, counter: 1, device: 'a' })).toBe(0)
  })

  test('hlc string roundtrip', () => {
    const h = { wall: 0xabc, counter: 0x12, device: 'dev-1' }
    expect(hlcFromString(hlcToString(h))).toEqual(h)
  })

  test('nextHlc increments counter on same wall', () => {
    const s = { wall: 10, counter: 2 }
    const r1 = nextHlc(s, 10, 'd')
    expect(r1.hlc).toEqual({ wall: 10, counter: 3, device: 'd' })
    const r2 = nextHlc(r1.state, 9, 'd')
    expect(r2.hlc.wall).toBe(10)
    expect(r2.hlc.counter).toBe(4)
  })

  test('receiveHlc caps remote wall skew', () => {
    const state = { wall: 5, counter: 0 }
    const remote = { wall: 1_000_000, counter: 0, device: 'x' }
    const r = receiveHlc(state, remote, 10, 'd')
    expect(r.skew).toBe(true)
    expect(r.hlc.wall).toBeLessThanOrEqual(10 + 5 * 60 * 1000)
  })
})

describe('sync merge', () => {
  test('shouldApply true when no existing', () => {
    const incoming = { hlc: hlcToString({ wall: 1, counter: 0, device: 'a' }) } as any
    expect(shouldApply(null, incoming)).toBe(true)
  })

  test('shouldApply compares hlc', () => {
    const existing = { hlc: hlcToString({ wall: 2, counter: 0, device: 'a' }) } as any
    const incoming = { hlc: hlcToString({ wall: 1, counter: 0, device: 'a' }) } as any
    expect(shouldApply(existing, incoming)).toBe(false)
    const incoming2 = { hlc: hlcToString({ wall: 3, counter: 0, device: 'a' }) } as any
    expect(shouldApply(existing, incoming2)).toBe(true)
  })

  test('mergeProgress sticky finished', () => {
    expect(mergeProgress(true, false, true)).toBe(true)
    expect(mergeProgress(false, true, true)).toBe(true)
    expect(mergeProgress(false, true, false)).toBe(false)
    expect(mergeProgress(false, false, true)).toBe(false)
  })
})

describe('sync keys', () => {
  test('contentKey, episodeKey, progressKey', () => {
    expect(contentKey('p', 'ref')).toBe('p:p:ref')
    expect(episodeKey(1, 2, 'r')).toBe('s1e2')
    expect(episodeKey(null, 5, 'r')).toBe('e5')
    expect(episodeKey(null, null, 'r')).toBe('r:r')
    expect(episodeKey(null, null, null)).toBe('movie')
    expect(progressKey('ck', 'ek')).toBe('ck#ek')
  })
})
