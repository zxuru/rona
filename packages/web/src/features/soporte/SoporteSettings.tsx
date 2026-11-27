/**
 * La sección «Soporte» de Ajustes.
 *
 * Dos cosas: el repositorio a un clic —con el icono de GitHub, que es lo que se
 * reconoce antes de leer— y el formulario que deja escrito el reporte y abre la
 * página de incidencias de GitHub con el texto puesto.
 *
 * El mismo formulario vive también en el pie, dentro de un diálogo, para no
 * tener que pasar por Ajustes cuando algo acaba de fallar. Aquí queda la versión
 * larga, con el repositorio y las incidencias a la vista.
 *
 * **Nada se envía desde aquí.** El enlace abre una pestaña nueva; quien reporta
 * revisa el borrador en GitHub y decide si lo publica. Es la misma promesa del
 * pie de la aplicación: sin cuentas propias, sin telemetría y sin un servidor de
 * incidencias que haya que mantener.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { SiGithub } from 'react-icons/si'
import { t } from '../../i18n'
import { FormularioReporte } from './FormularioReporte'
import { INCIDENCIAS, REPOSITORIO } from './soporte'

const LOCALE = DEFAULT_LOCALE

export function SoporteSettings(): ReactNode {
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

        <FormularioReporte idPrefijo="soporte" />
      </section>
    </>
  )
}
