import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft } from "lucide-react"
import { useNavigate } from "react-router-dom"

export function ServerDetailChartLoading() {
  return (
    <div className="space-y-4">
      <section className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[128px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[128px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[128px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[220px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[220px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
      </section>
      <section className="grid gap-3 min-[720px]:grid-cols-2 min-[1101px]:grid-cols-4">
        <Skeleton className="h-[264px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[264px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[264px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
        <Skeleton className="h-[264px] w-full rounded-lg bg-muted-foreground/10 animate-none" />
      </section>
    </div>
  )
}

export function ServerDetailLoading() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[1920px] px-0">
      <div
        onClick={() => {
          navigate("/")
        }}
        className="flex flex-none cursor-pointer font-semibold leading-none items-center break-all tracking-tight gap-0.5 text-xl"
      >
        <ArrowLeft className="size-[17px]" />
        <Skeleton className="h-[20px] w-24 rounded-[5px] bg-muted-foreground/10 animate-none"></Skeleton>
      </div>
      <Skeleton className="flex flex-wrap gap-2 h-[81px] w-1/2 mt-3 rounded-[5px] bg-muted-foreground/10 animate-none"></Skeleton>
    </div>
  )
}
