import { parseCardTags, SERVER_TAG_TONE } from "@/lib/server-tags"
import { PublicNoteData } from "@/lib/utils"

export default function PlanInfo({
  parsedData,
  tags,
}: {
  parsedData?: PublicNoteData | null
  tags?: string | null
}) {
  const extraList = parseCardTags({
    tags,
    extra: parsedData?.planDataMod?.extra,
  })
  if (extraList.length === 0) return null

  return (
    <section className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {extraList.map((extra) => {
        const tone = SERVER_TAG_TONE[extra.color]
        return (
          <span
            key={`${extra.color}:${extra.text}`}
            className="whitespace-nowrap rounded-[6px] px-[7px] py-1 text-[10px] font-medium [background:var(--tag-bg)] [color:var(--tag-fg)] dark:[background:var(--tag-dark-bg)] dark:[color:var(--tag-dark-fg)]"
            style={{
              ["--tag-bg" as string]: tone.bg,
              ["--tag-fg" as string]: tone.fg,
              ["--tag-dark-bg" as string]: tone.darkBg,
              ["--tag-dark-fg" as string]: tone.darkFg,
            }}
          >
            {extra.text}
          </span>
        )
      })}
    </section>
  )
}
