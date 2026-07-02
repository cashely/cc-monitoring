import { useMemo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import { parseDiffFromFile, type FileContents } from '@pierre/diffs'

interface Props {
  leftText: string
  rightText: string
  lang?: string
}

export function DiffPanel({ leftText, rightText, lang = 'json' }: Props): JSX.Element {
  const fileDiff = useMemo(() => {
    if (!leftText || !rightText) return null
    const oldFile: FileContents = {
      name: `left.${lang}`,
      contents: leftText,
      lang,
    }
    const newFile: FileContents = {
      name: `right.${lang}`,
      contents: rightText,
      lang,
    }
    try {
      return parseDiffFromFile(oldFile, newFile)
    } catch (err) {
      console.error('DiffPanel parse error:', err)
      return null
    }
  }, [leftText, rightText, lang])

  if (!fileDiff) {
    return <div className="text-text-muted text-center py-8">无数据</div>
  }

  return (
    <div className="max-h-[70vh] overflow-auto">
      <FileDiff fileDiff={fileDiff} />
    </div>
  )
}
