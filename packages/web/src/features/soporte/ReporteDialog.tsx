/**
 * El reporte de un problema, en un diálogo desde el pie.
 *
 * Es el camino corto: algo acaba de fallar, el pie está a la vista y el
 * formulario se abre encima de la pantalla, sin navegar ni perder de vista lo
 * que se estaba haciendo. El formulario es el mismo de Ajustes → Soporte.
 *
 * El diálogo es el `<dialog>` nativo, como el aviso de seguridad: el navegador
 * trae el `Esc`, el foco atrapado, el fondo inerte y el velo. Reproducirlo a
 * mano con un `div` es el camino por el que se cuelan los modales inaccesibles.
 * Al abrirse, el foco va al asunto y no al botón de cerrar: lo que sigue es
 * escribir.
 */

import { DEFAULT_LOCALE } from '@rona/core/i18n'
import { ExternalLink } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { FormularioReporte } from './FormularioReporte'
import { INCIDENCIAS } from './soporte'

const LOCALE = DEFAULT_LOCALE

export interface ReporteDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function ReporteDialog(props: ReporteDialogProps): ReactNode {
  const dialogo = useRef<HTMLDialogElement>(null)

  // `showModal` y no el atributo `open`: el atributo pinta el diálogo pero no lo
  // hace modal —ni foco atrapado, ni `Esc`, ni fondo inerte—.
  useEffect(() => {
    const nodo = dialogo.current
    if (nodo === null) return

    if (props.open && !nodo.open) {
      nodo.showModal()
      nodo.querySelector<HTMLInputElement>('input[type="text"]')?.focus()
    }

    if (!props.open && nodo.open) nodo.close()
  }, [props.open])

  // El clic en el fondo llega con el propio diálogo como destino: dentro, el
  // destino es siempre un hijo. Se escucha aquí y no con `onClick` en el JSX
  // porque el fondo no es un elemento interactivo y no tiene equivalente de
  // teclado que declarar: cerrar con el teclado ya es `Esc`.
  useEffect(() => {
    const nodo = dialogo.current
    if (nodo === null) return

    const enFondo = (event: MouseEvent): void => {
      if (event.target === nodo) props.onClose()
    }

    nodo.addEventListener('click', enFondo)
    return () => nodo.removeEventListener('click', enFondo)
  }, [props.onClose])

  return (
    <dialog
      ref={dialogo}
      className="notice reporte"
      aria-labelledby="reporte-titulo"
      onClose={props.onClose}
    >
      <header className="notice__head">
        <h2 className="notice__title" id="reporte-titulo">
          {t(LOCALE, 'settings.support.report')}
        </h2>
        <button type="button" className="notice__close" onClick={props.onClose}>
          {t(LOCALE, 'soporte.dialog.close')}
        </button>
      </header>

      <div className="notice__body reporte__cuerpo">
        <p>{t(LOCALE, 'settings.support.report.body')}</p>
        {/*
          El formulario se monta sólo con el diálogo abierto. Así el pie no pide
          nada al servidor hasta que se usa y cada apertura empieza limpia.
        */}
        {props.open ? <FormularioReporte idPrefijo="reporte" /> : null}
      </div>

      <footer className="notice__foot">
        <a href={INCIDENCIAS} target="_blank" rel="noreferrer noopener">
          {t(LOCALE, 'settings.support.issues')}
          <ExternalLink size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
        </a>
      </footer>
    </dialog>
  )
}
