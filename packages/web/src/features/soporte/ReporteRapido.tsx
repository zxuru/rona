/**
 * El botón que abre el reporte, en sus dos formas.
 *
 * En el pie va con texto —«Reportar un problema»—, porque comparte fila con el
 * icono del repositorio y hay sitio. En las pantallas de reproducción va sólo
 * con el dibujo: el encabezado se mide contra la ventana y un botón de texto más
 * le robaba ancho al título. El nombre accesible lo pone el `aria-label`.
 *
 * Cada instancia lleva su propio diálogo y su propio prefijo de ids, para que
 * dos montajes a la vez —el pie y la pantalla— no repitan identificadores.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { Bug } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { ReporteDialog } from './ReporteDialog'

const LOCALE = DEFAULT_LOCALE

export type VarianteDeReporte = 'pie' | 'icono' | 'enlace'

export interface ReporteRapidoProps {
  readonly variante: VarianteDeReporte
}

export function ReporteRapido(props: ReporteRapidoProps): ReactNode {
  const [abierto, setAbierto] = useState(false)
  const etiqueta = t(LOCALE, 'soporte.footer.report')
  const idPrefijo = `reporte-${props.variante}`

  return (
    <>
      {props.variante === 'pie' ? (
        <button
          type="button"
          className="shell__footer-reporte"
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
        >
          <Bug size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          {etiqueta}
        </button>
      ) : props.variante === 'enlace' ? (
        <button
          type="button"
          className="reporte-rapido__enlace"
          aria-label={etiqueta}
          title={etiqueta}
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
        >
          <Bug size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
          {t(LOCALE, 'soporte.footer.reportShort')}
        </button>
      ) : (
        <button
          type="button"
          className="reporte-rapido__icono"
          aria-label={etiqueta}
          title={etiqueta}
          aria-haspopup="dialog"
          onClick={() => setAbierto(true)}
        >
          <Bug size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
      )}

      <ReporteDialog open={abierto} onClose={() => setAbierto(false)} idPrefijo={idPrefijo} />
    </>
  )
}
