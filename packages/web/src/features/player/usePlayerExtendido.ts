/**
 * El modo extendido: el reproductor llena la ventana sin pantalla completa.
 *
 * No es la Fullscreen API ni una orden a Tauri: es un atributo en el contenedor
 * y CSS. Por eso no interrumpe nada —el `<video>` y `hls.js` son los mismos
 * nodos— y por eso respeta el tamaño de la ventana: al redimensionarla o
 * maximizarla, el `inset: 0` la sigue sin recalcular nada.
 *
 * Arranca con la preferencia guardada, que es la que Ajustes deja puesta para
 * las próximas veces. Se guarda en cada cambio: quien apaga y enciende el modo
 * está eligiendo cómo quiere que abra el reproductor.
 *
 * En táctil hay además un modo **forzado**: el teléfono tumbado enseña el video a
 * pantalla completa sin pedirle permiso al navegador —`requestFullscreen` exige un
 * gesto, y girar el aparato no lo es—. Lo forzado no se guarda: al volver a
 * vertical, el teléfono recupera la pantalla normal. En táctil la preferencia
 * guardada tampoco se aplica —es una decisión de ventana de escritorio—, así que
 * la postura es la única que decide.
 */

import { useCallback, useEffect, useState } from 'react'
import { alternarExtendido, guardarExtendido, leerExtendido } from './extendido'
import { almacenLocal } from './storage'

export interface ModoExtendido {
  readonly extendido: boolean
  /** El gesto de la tecla `T`, del `Escape` y del botón: enciende y apaga. */
  readonly alternar: () => void
}

export function usePlayerExtendido(forzado = false, ignorarPreferencia = false): ModoExtendido {
  const [elegido, setElegido] = useState(() => leerExtendido(almacenLocal()))
  const extendido = forzado || (!ignorarPreferencia && elegido)

  useEffect(() => {
    guardarExtendido(almacenLocal(), elegido)
  }, [elegido])

  // Mientras ocupa la ventana entera, la página de debajo no se desplaza: un
  // `position: fixed` no impide el desplazamiento del documento, y el gesto de
  // rueda en el borde del video movía el contenido que no se ve. La clase va en
  // el `body` y se retira al salir —o al desmontar la pantalla, que es lo que
  // pasa al cambiar de episodio—.
  useEffect(() => {
    if (!extendido) return

    document.body.classList.add('player-extendido')

    return () => {
      document.body.classList.remove('player-extendido')
    }
  }, [extendido])

  const alternar = useCallback(() => {
    setElegido(alternarExtendido)
  }, [])

  return { extendido, alternar }
}
