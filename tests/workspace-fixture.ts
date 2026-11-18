// Two matching lines give the test a precise page and line target.
const stream = 'BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\nBT /F1 12 Tf 72 600 Td (Pay in 15 days) Tj ET\n'
const secondStream = 'BT /F1 12 Tf 72 650 Td (Payment schedule) Tj ET\nBT /F1 12 Tf 72 600 Td (Pay in 15 days) Tj ET\n'
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  `<< /Length ${secondStream.length} >>\nstream\n${secondStream}endstream`,
]
let pdf = '%PDF-1.4\n'
const offsets = objects.map((object, i) => {
  const offset = pdf.length
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
  return offset
})
const xref = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}`
pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`

export const workspacePdf = Buffer.from(pdf, 'ascii')
export const workspaceFixture = (recipient = 'fixture-party@example.com') => ({
  team: [recipient], document: { name: 'Fixture contract.pdf', data: workspacePdf.toString('base64') },
})
