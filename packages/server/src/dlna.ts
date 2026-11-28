// DLNA/UPnP experimental (T398). MP4 progresivo via AVTransport.
// Implementacion minima: discovery SSDP + control SOAP. Puede tener errores.

export type DlnaDevice = {
  udn: string
  location: string
  friendlyName: string
  avTransport: boolean
}

export function parseDescription(xml: string): { udn: string; friendlyName: string; avTransport: boolean } {
  const udn = (xml.match(/<UDN>([^<]+)<\/UDN>/i)?.[1] ?? '').trim()
  const friendlyName = (xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i)?.[1] ?? '').trim()
  const avTransport = /AVTransport/i.test(xml)
  return { udn, friendlyName, avTransport }
}

export function ssdpSearchMessage(): string {
  return [
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    'MAN: "ssdp:discover"',
    'MX: 1',
    'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
    '',
    '',
  ].join('\r\n')
}

export function setAvTransportUriSoap(url: string, title: string): string {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><CurrentURI>${escapeXml(url)}</CurrentURI><CurrentURIMetaData>${escapeXml(title)}</CurrentURIMetaData></u:SetAVTransportURI></s:Body></s:Envelope>`
}

export function playSoap(): string {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play></s:Body></s:Envelope>`
}

export function pauseSoap(): string {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:Pause></s:Body></s:Envelope>`
}

export function stopSoap(): string {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:Stop></s:Body></s:Envelope>`
}

export function seekSoap(position: string): string {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${escapeXml(position)}</Target></u:Seek></s:Body></s:Envelope>`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
