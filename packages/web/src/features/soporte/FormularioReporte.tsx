/**
 * El formulario del reporte, sin el marco que lo contiene.
 *
 * Lo usan la sección de Ajustes y el diálogo del pie. El estado es de cada
 * instancia —lo que se escribe en uno no aparece en el otro—, y por eso el
 * marcado recibe un prefijo: dos formularios montados a la vez no pueden repetir
 * los `id` de sus ayudas.
 *
 * **Nada se envía desde aquí.** El botón es un enlace que abre la página de una
 * incidencia nueva en GitHub con el texto puesto; el envío lo hace quien reporta,
 * allí, después de revisarlo. La CSP del servidor limita `form-action` a
 * `'self'`, así que un formulario HTML con `action` en GitHub quedaría bloqueado.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Send } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import {
  cuerpoDelReporte,
  type Entorno,
  entornoDeVentana,
  LIMITE_ASUNTO,
  LIMITE_DESCRIPCION,
  urlDelReporte,
} from './soporte'
import { useVersionDeRona } from './version'

const LOCALE = DEFAULT_LOCALE

/** Las líneas del contexto, con las mismas etiquetas del catálogo. */
export function contextoDelReporte(entorno: Entorno | undefined): string {
  if (entorno === undefined) return ''

  return [
    t(LOCALE, 'settings.support.context.header'),
    `- ${t(LOCALE, 'settings.support.context.version')}: ${
      entorno.version ?? t(LOCALE, 'settings.support.version.unknown')
    }`,
    `- ${t(LOCALE, 'settings.support.context.path')}: ${entorno.ruta}`,
    `- ${t(LOCALE, 'settings.support.context.browser')}: ${entorno.navegador}`,
    `- ${t(LOCALE, 'settings.support.context.window')}: ${entorno.ancho}×${entorno.alto}`,
  ].join('\n')
}

export interface FormularioReporteProps {
  /** El prefijo de los `id` del marcado. Dos formularios no pueden compartirlo. */
  readonly idPrefijo: string
}

export function FormularioReporte(props: FormularioReporteProps): ReactNode {
  const version = useVersionDeRona()
  const [asunto, setAsunto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [adjuntar, setAdjuntar] = useState(true)
  const [intento, setIntento] = useState(false)

  /*
    El contexto se lee de `window` y no de un hook: no cambia con el tiempo —la
    ruta es la de la pantalla y el navegador tampoco se muda— y leerlo en el
    render deja la dirección del enlace siempre al día con lo que se escribe.
  */
  const entorno = adjuntar
    ? entornoDeVentana(typeof window === 'undefined' ? undefined : window, version)
    : undefined
  const url = urlDelReporte(asunto, cuerpoDelReporte(descripcion, contextoDelReporte(entorno)))

  const faltaAsunto = asunto.trim() === ''
  const faltaDescripcion = descripcion.trim() === ''
  const valido = !faltaAsunto && !faltaDescripcion
  const ayuda = `${props.idPrefijo}-descripcion-ayuda`

  return (
    <div className="reporte__form">
      <label className="field">
        <span className="field__label">{t(LOCALE, 'settings.support.subject')}</span>
        <input
          className="field__input"
          type="text"
          value={asunto}
          maxLength={LIMITE_ASUNTO}
          onChange={(event) => setAsunto(event.target.value)}
          aria-invalid={intento && faltaAsunto ? true : undefined}
        />
      </label>

      <label className="field">
        <span className="field__label">{t(LOCALE, 'settings.support.description')}</span>
        <textarea
          className="field__input field__input--area"
          value={descripcion}
          maxLength={LIMITE_DESCRIPCION}
          rows={5}
          onChange={(event) => setDescripcion(event.target.value)}
          aria-describedby={ayuda}
          aria-invalid={intento && faltaDescripcion ? true : undefined}
        />
        <span className="field__hint" id={ayuda}>
          {t(LOCALE, 'settings.support.description.hint')}
        </span>
      </label>

      <label className="field field--check">
        <input
          type="checkbox"
          checked={adjuntar}
          onChange={(event) => setAdjuntar(event.target.checked)}
        />
        {t(LOCALE, 'settings.support.context')}
      </label>
      <p className="field__hint">{t(LOCALE, 'settings.support.context.help')}</p>

      {intento && !valido ? (
        <p className="field__aviso" role="alert">
          {t(LOCALE, 'settings.support.required')}
        </p>
      ) : null}

      {/*
        Un enlace que se ve como el botón primario. Con los dos campos vacíos se
        frena la navegación y se dice qué falta; el `href` ya construido sirve
        igual si alguien abre el enlace en otra pestaña o sin JavaScript.
      */}
      <div className="settings__actions">
        <a
          className="button button--primary button--con-icono"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (valido) return

            event.preventDefault()
            setIntento(true)
          }}
        >
          <Send size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(LOCALE, 'settings.support.open')}
        </a>
      </div>
      <p className="field__hint">{t(LOCALE, 'settings.support.open.help')}</p>
    </div>
  )
}
