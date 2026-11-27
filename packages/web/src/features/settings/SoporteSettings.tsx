/**
 * La sección «Soporte» de Ajustes.
 *
 * Dos cosas: el repositorio a un clic —con el icono de GitHub, que es lo que se
 * reconoce antes de leer— y un formulario que deja escrito el reporte y abre la
 * página de incidencias de GitHub con el texto puesto.
 *
 * **Nada se envía desde aquí.** El enlace abre una pestaña nueva; quien reporta
 * revisa el borrador en GitHub y decide si lo publica. Es la misma promesa del
 * pie de la aplicación: sin cuentas propias, sin telemetría y sin un servidor de
 * incidencias que haya que mantener.
 *
 * El contexto técnico es opcional y se ve: versión, ruta, navegador y tamaño de
 * la ventana. Se puede desactivar antes de abrir el borrador, y sólo viaja en la
 * dirección que se construye en ese momento.
 */

import { healthResponseSchema } from '@rona/core/api'
import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { ExternalLink, Send } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { SiGithub } from 'react-icons/si'
import { apiGet } from '../../api/client'
import { t } from '../../i18n'
import {
  cuerpoDelReporte,
  type Entorno,
  entornoDeVentana,
  INCIDENCIAS,
  LIMITE_ASUNTO,
  LIMITE_DESCRIPCION,
  REPOSITORIO,
  urlDelReporte,
} from './soporte'

const LOCALE = DEFAULT_LOCALE

/**
 * El plazo de la lectura de la versión.
 *
 * Es un adorno del reporte: si el health tarda o falla, el formulario funciona
 * igual y el contexto dice que la versión no está disponible. No bloquea nada.
 */
const VERSION_TIMEOUT_MS = 4_000

/**
 * La versión de la instalación, si el servidor la contesta.
 *
 * `/api/health` ya la publica para el resto de la aplicación y no hace falta un
 * campo nuevo en los ajustes. Un fallo se calla: el reporte sigue siendo útil sin
 * la versión, y un aviso de error aquí distraería del formulario.
 */
function useVersionDeRona(): string | undefined {
  const [version, setVersion] = useState<string | undefined>(undefined)

  useEffect(() => {
    let vivo = true

    apiGet('/api/health', healthResponseSchema, { timeoutMs: VERSION_TIMEOUT_MS }).then(
      (salud) => {
        if (vivo) setVersion(salud.version)
      },
      () => {
        // Sin versión el contexto lo dice; no hay nada que reparar en pantalla.
      },
    )

    return () => {
      vivo = false
    }
  }, [])

  return version
}

/** Las líneas del contexto, con las mismas etiquetas del catálogo. */
function contextoDelReporte(entorno: Entorno | undefined): string {
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

export function SoporteSettings(): ReactNode {
  const version = useVersionDeRona()
  const [asunto, setAsunto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [adjuntar, setAdjuntar] = useState(true)
  const [intento, setIntento] = useState(false)

  /*
    El contexto se lee de `window` y no de un hook: no cambia con el tiempo —la
    ruta es la de Ajustes y el navegador tampoco se muda— y leerlo en el render
    deja la dirección del enlace siempre al día con lo que se está escribiendo.
  */
  const entorno = adjuntar
    ? entornoDeVentana(typeof window === 'undefined' ? undefined : window, version)
    : undefined
  const url = urlDelReporte(asunto, cuerpoDelReporte(descripcion, contextoDelReporte(entorno)))

  const faltaAsunto = asunto.trim() === ''
  const faltaDescripcion = descripcion.trim() === ''
  const valido = !faltaAsunto && !faltaDescripcion

  return (
    <>
      <section>
        <h3>{t(LOCALE, 'settings.support.repo')}</h3>

        {/*
          La tarjeta es un enlace entera: el icono, el nombre y la nota son el
          mismo gesto. El dibujo va decorativo y el nombre accesible lo pone el
          texto de dentro.
        */}
        <a
          className="settings__github"
          href={REPOSITORIO}
          target="_blank"
          rel="noreferrer noopener"
        >
          <SiGithub
            className="settings__github-icono"
            size={28}
            aria-hidden="true"
            focusable="false"
          />
          <span className="settings__github-texto">
            <span className="settings__github-nombre">zxuru/rona</span>
            <span className="settings__github-nota">{t(LOCALE, 'settings.support.repo.body')}</span>
          </span>
          <ExternalLink
            className="settings__github-salida"
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          />
        </a>

        <p className="field__hint">
          <a
            className="settings__link settings__link--icono"
            href={INCIDENCIAS}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t(LOCALE, 'settings.support.issues')}
            <ExternalLink size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
          </a>
        </p>
      </section>

      <section>
        <h3>{t(LOCALE, 'settings.support.report')}</h3>
        <p>{t(LOCALE, 'settings.support.report.body')}</p>

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
            rows={6}
            onChange={(event) => setDescripcion(event.target.value)}
            aria-describedby="soporte-descripcion-ayuda"
            aria-invalid={intento && faltaDescripcion ? true : undefined}
          />
          <span className="field__hint" id="soporte-descripcion-ayuda">
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
          Un enlace que se ve como el botón primario. Con los dos campos vacíos
          se frena la navegación y se dice qué falta; el `href` ya construido
          sirve igual si alguien abre el enlace en otra pestaña o sin JavaScript.
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
      </section>
    </>
  )
}
