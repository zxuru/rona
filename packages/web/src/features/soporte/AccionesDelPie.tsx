/**
 * Las acciones del pie: el repositorio y el reporte rápido.
 *
 * El pie estaba sólo para la promesa de privacidad. Aquí se le añade la salida
 * cuando algo no funciona: el icono de GitHub —lo que se reconoce antes de
 * leer— y un botón que abre el formulario en un diálogo.
 *
 * El botón no navega: abre el diálogo que vive al lado. Su `aria-haspopup` dice
 * que hay un diálogo detrás, y el `<dialog>` se encarga del resto.
 *
 * El pie no se pinta en las pantallas de reproducción —se miden contra la
 * ventana—, así que estas acciones tampoco. Allí el reporte sigue en Ajustes.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Bug } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { SiGithub } from 'react-icons/si'
import { t } from '../../i18n'
import { ReporteDialog } from './ReporteDialog'
import { REPOSITORIO } from './soporte'

const LOCALE = DEFAULT_LOCALE

export function AccionesDelPie(): ReactNode {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
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

        <button
          type="button"
          className="shell__footer-reporte"
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
        >
          <Bug size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(LOCALE, 'soporte.footer.report')}
        </button>
      </div>

      <ReporteDialog open={abierto} onClose={() => setAbierto(false)} />
    </>
  )
}
