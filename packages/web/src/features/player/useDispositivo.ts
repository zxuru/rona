/**
 * Las dos preguntas del aparato que cambian los mandos del reproductor.
 *
 * **Táctil** no es «ventana estrecha»: un escritorio con la ventana a 390 px sigue
 * teniendo teclado, ratón y mpv. Lo que sobra en un teléfono sobra por cómo se
 * maneja, no por cuánto mide la ventana, así que se pregunta por el puntero
 * **grueso** —el primario es el dedo— y no por el ancho. Eso además sobrevive al
 * giro: en horizontal la ventana mide 844 px y el aparato sigue siendo el mismo.
 *
 * **Paisaje** es la postura, no el aparato: en horizontal el video ocupa la
 * pantalla y en vertical vuelve a su sitio. Se lee de la consulta de orientación y
 * no de `screen.orientation`, que no existe en todos los navegadores.
 */

import { useConsultaDeMedios } from '../../lib/useConsultaDeMedios'

/** ¿Se maneja con el dedo? En un portátil con pantalla táctil manda el ratón. */
export function usePunteroGrueso(): boolean {
  return useConsultaDeMedios('(pointer: coarse)')
}

/** ¿La ventana está tumbada? */
export function usePaisaje(): boolean {
  return useConsultaDeMedios('(orientation: landscape)')
}
