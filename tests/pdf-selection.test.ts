import { describe, expect, it } from 'vite-plus/test'
import { matchSourceBlock, type PdfSelection } from '../apps/web/src/pdf-selection.ts'
import type { PdfAnnotation, PdfTextBlock } from '../packages/contracts/src/index.ts'

const block: PdfTextBlock = {page: 1, block: 3, text:'Pay in 15 days', baseline:[72,600]}
const selection: PdfSelection = {page:2, quote:'15 days', digest:'d'.repeat(64), singleLine:true, run:{text:block.text, x:72, y:600}}
describe('PDF passage mapping', () => {
  it('distinguishes the selected line from identical wording at a different baseline', () => {
    expect(matchSourceBlock(selection, [{...block, block:1, baseline:[72,650]}, block], [])).toBe(block)
    expect(matchSourceBlock(selection, [block, block], [])).toBeUndefined()
  })
  it('keeps selections that cross lines and uncertain glyph mappings available for discussion', () => {
    expect(matchSourceBlock({...selection, singleLine:false}, [block], [])).toBeUndefined()
    expect(matchSourceBlock({...selection, run:{text:'15 days',x:90,y:600}}, [block], [])).toBeUndefined()
  })
  it('maps untouched wording after a rewrite and refuses replaced wording', () => {
    const mark: PdfAnnotation = {id:'1', page:2, author:'p', createdAt:'now', text:'', replies:[],
      decision:{status:'Approved', author:'p', at:'now'}, edit:{...block, offset:7, expected:'15',replacement:'30'}}
    const current = {...selection, run:{...selection.run!,text:'Pay in 30 days'}}
    expect(matchSourceBlock({...current, quote:'Pay'}, [block], [mark])).toBe(block)
    expect(matchSourceBlock({...current, quote:'30'}, [block], [mark])).toBeUndefined()
  })
})
