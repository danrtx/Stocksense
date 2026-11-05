import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { parseQuantity } from '../../lib/quantity'
import { QuantityStepper } from './QuantityStepper'

function Harness({ initial = '', whole = true }: { initial?: string; whole?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="q">Cantidad</label>
      <QuantityStepper id="q" value={value} onChange={setValue} unit="UND" whole={whole} />
    </>
  )
}

describe('Control de cantidad', () => {
  it('suma y resta con los botones (activados con teclado) y no baja de 0', async () => {
    render(<Harness />)
    const minus = screen.getByRole('button', { name: 'Quitar uno' })
    const plus = screen.getByRole('button', { name: 'Agregar uno' })
    expect(minus).toBeDisabled()
    plus.focus()
    await userEvent.keyboard('{Enter}{Enter}')
    expect(screen.getByLabelText('Cantidad')).toHaveValue('2')
    minus.focus()
    await userEvent.keyboard('{Enter}{Enter}{Enter}')
    expect(screen.getByLabelText('Cantidad')).toHaveValue('')
  })

  it('las flechas del teclado cambian la cantidad dentro del campo', () => {
    render(<Harness initial="4" />)
    const input = screen.getByLabelText('Cantidad')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('5')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('3')
  })

  it('pide el teclado decimal para unidades que se fraccionan', () => {
    render(<Harness whole={false} />)
    expect(screen.getByLabelText('Cantidad')).toHaveAttribute('inputmode', 'decimal')
  })

  it('lee cantidades con coma o punto', () => {
    expect(parseQuantity('2,5')).toBe(2.5)
    expect(parseQuantity(' 3.25 ')).toBe(3.25)
    expect(parseQuantity('abc')).toBeNaN()
  })
})
