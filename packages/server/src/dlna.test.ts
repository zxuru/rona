import { describe, expect, test } from 'bun:test'
import { parseDescription, ssdpSearchMessage, setAvTransportUriSoap, playSoap, pauseSoap, stopSoap, seekSoap } from './dlna'

describe('dlna', () => {
  test('parseDescription', () => {
    const xml = '<root><UDN>uuid:abc</UDN><friendlyName>TV</friendlyName><serviceType>AVTransport</serviceType></root>'
    expect(parseDescription(xml)).toEqual({ udn: 'uuid:abc', friendlyName: 'TV', avTransport: true })
  })
  test('ssdp message has ST', () => {
    expect(ssdpSearchMessage()).toContain('ST: urn:schemas-upnp-org:device:MediaRenderer:1')
  })
  test('soap helpers produce xml', () => {
    expect(setAvTransportUriSoap('http://x/v.mp4', 'Title')).toContain('SetAVTransportURI')
    expect(playSoap()).toContain('Play')
    expect(pauseSoap()).toContain('Pause')
    expect(stopSoap()).toContain('Stop')
    expect(seekSoap('00:01:00')).toContain('Seek')
  })
})
