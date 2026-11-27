/**
 * Las acciones del pie: el repositorio y el reporte rápido.
 *
 * El pie estaba sólo para la promesa de privacidad. Aquí se le añade la salida
 * cuando algo no funciona: el icono de GitHub —lo que se reconoce antes de
 * leer— y el botón que abre el formulario en un diálogo.
 *
 * El botón no navega: abre el diálogo que vive al lado. Su `aria-haspopup` dice
 * que hay un diálogo detrás, y el `<dialog>` se encarga del resto.
 *
 * El pie no se pinta en las pantallas de reproducción, que se miden contra la
 * ventana; allí el reporte va como icono en el encabezado de la pantalla, con
 * el mismo componente y el mismo formulario.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import type { ReactNode } from 'react'
import { SiGithub } from 'react-icons/si'
import { t } from '../../i18n'
import { ReporteRapido } from './ReporteRapido'
import { REPOSITORIO } from './soporte'

const LOCALE = DEFAULT_LOCALE

export function AccionesDelPie(): ReactNode {
  return (
    <div className="shell__footer-acciones">
      <a
        className="shell__footer-github"
        href={REPOSITORIO}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={t(LOCALE, 'soporte.footer.github')}
        title={t(LOCALE, 'soporte.footer.github')}
      >
        <SiGithub size={20} aria-hidden="true" focusable="false" />
      </a>

      <ReporteRapido variante="pie" />
    </div>
  )
}
