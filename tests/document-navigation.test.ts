import { describe, expect, it } from 'vite-plus/test'
import { indexEntries, outline, type Passage } from '../apps/web/src/app/canvas-editor/navigation.ts'

const clauses: Passage[] = [
  {key:'intro', position:1, text:'Article I Definitions'},
  {key:'term', position:30, text:'“Delivery” means receipt at the port.'},
  {key:'timing', position:80, text:'2.1 Timing'},
  {key:'deadline', position:100, text:'Delivery follows Section 2.1 and Section 9.'},
]
describe('document navigation', () => {
  it('detects nested clauses and persists manual additions, nesting corrections and dismissals', () => {
    expect(outline(clauses, []).map(row => [row.key, row.level])).toEqual([['intro',1],['timing',2]])
    const edited = outline(clauses, [
      {action:'outline', key:'timing', title:'Timing', level:1, hidden:true},
      {action:'outline', key:'term', title:'Defined terms', level:2, hidden:false},
    ])
    expect(edited.map(row => row.title)).toEqual(['Article I Definitions','Defined terms'])
    expect(clauses[1].text).toBe('“Delivery” means receipt at the port.')
  })
  it('links definitions, occurrences and cross-references with explicit missing targets', () => {
    const index = new Map(indexEntries(clauses, ''))
    expect(index.get('Delivery')?.map(row => row.description)).toEqual(['Definition','Occurrence'])
    expect(index.get('Section 2.1')?.map(row => row.key)).toEqual(['timing','deadline'])
    expect(index.get('Section 9')?.[0].description).toBe('Missing target')
    expect(indexEntries(clauses, 'receipt')[0][1][0]).toMatchObject({key:'term', text:'receipt'})
  })
  it('keeps pages navigable in unstructured PDFs and prefers matching bookmarks', () => {
    const page = {key:'page-2',page:2,text:'Page 2'}
    expect(outline([page,{key:'text',page:2,item:0,text:'Payment in full'}],[])).toEqual([page])
    const heading = {key:'article',page:2,item:1,text:'Article II Payment'}
    const bookmark = {...heading,key:'bookmark',bookmark:true,level:1}
    expect(outline([page,heading,bookmark],[]).map(item => item.key)).toEqual(['bookmark'])
  })
})
