/**
 * El reporte de un problema, camino de GitHub.
 *
 * RoNa no tiene servidor de incidencias ni cuentas: lo que puede hacer es dejar
 * el reporte escrito y abrir la página de GitHub con el texto puesto, para que
 * quien lo envía sólo tenga que revisarlo y pulsar «Submit new issue». Nada se
 * manda desde la aplicación.
 *
 * **El enlace es un `<a>` y no un formulario.** La CSP del servidor limita
 * `form-action` a `'self'`, así que un formulario con `action` en GitHub quedaría
 * bloqueado por el navegador. Una navegación de enlace no pasa por esa directiva
 * —y el escritorio ya la intercepta para abrir el navegador del sistema—.
 *
 * Aquí viven las piezas que no necesitan React: el contexto que se adjunta y la
 * dirección que se abre. Se separan para poder medirlas sin un navegador.
 */

/** El repositorio del proyecto. Es también el destino del icono de GitHub. */
export const REPOSITORIO = 'https://github.com/zxuru/rona'

/** La lista de incidencias abiertas. */
export const INCIDENCIAS = `${REPOSITORIO}/issues`

/** El borrador de una incidencia nueva, que admite `title` y `body` en la consulta. */
export const NUEVA_INCIDENCIA = `${INCIDENCIAS}/new`

/**
 * Los topes de los dos campos.
 *
 * La dirección viaja en una consulta GET, y los navegadores y GitHub la cortan
 * hacia los 8 KB. El cuerpo admite más en GitHub, pero aquí se llega por enlace:
 * 2 000 caracteres de descripción dejan sitio al contexto y a la codificación de
 * los acentos sin acercarse al límite.
 */
export const LIMITE_ASUNTO = 120
export const LIMITE_DESCRIPCION = 2_000

/** Lo que se sabe de la instalación y se puede adjuntar al reporte. */
export interface Entorno {
  readonly version?: string
  readonly ruta: string
  readonly navegador: string
  readonly ancho: number
  readonly alto: number
}

/**
 * La parte de `window` que se lee.
 *
 * Se declara aquí y no se usa `Window` para que la prueba pueda pasar un objeto
 * mínimo: lo que se mide es la decisión —qué campos se copian y cómo—, no el DOM.
 */
export interface VentanaDelNavegador {
  readonly location: { readonly pathname: string }
  readonly navigator: { readonly userAgent: string }
  readonly innerWidth: number
  readonly innerHeight: number
}

/** Copia lo que la ventana sabe de sí misma. Sin ventana —el servidor— no hay contexto. */
export function entornoDeVentana(
  ventana: VentanaDelNavegador | undefined,
  version?: string,
): Entorno | undefined {
  if (ventana === undefined) return undefined

  return {
    ...(version === undefined ? {} : { version }),
    ruta: ventana.location.pathname,
    navegador: ventana.navigator.userAgent,
    ancho: ventana.innerWidth,
    alto: ventana.innerHeight,
  }
}

/**
 * El cuerpo del reporte: lo que escribió la persona y, debajo, el contexto.
 *
 * El filete separa las dos partes porque GitHub interpreta Markdown: sin él, el
 * contexto se leería como el final de la descripción. Si no hay contexto —la
 * casilla está apagada— no queda un filete colgando.
 */
export function cuerpoDelReporte(descripcion: string, contexto: string): string {
  const texto = descripcion.trim()
  const datos = contexto.trim()
  if (datos === '') return texto
  if (texto === '') return datos

  return `${texto}\n\n---\n\n${datos}`
}

/**
 * La dirección del borrador.
 *
 * Los campos vacíos no viajan: `?title=&body=` no aporta nada y deja una
 * dirección que parece un error. `URLSearchParams` codifica el texto entero,
 * incluidos los saltos de línea y los acentos, que es justo lo que un `+` manual
 * se dejaría por el camino.
 */
export function urlDelReporte(asunto: string, cuerpo: string): string {
  const parametros = new URLSearchParams()
  const titulo = asunto.trim()
  const texto = cuerpo.trim()

  if (titulo !== '') parametros.set('title', titulo)
  if (texto !== '') parametros.set('body', texto)

  const consulta = parametros.toString()
  return consulta === '' ? NUEVA_INCIDENCIA : `${NUEVA_INCIDENCIA}?${consulta}`
}
