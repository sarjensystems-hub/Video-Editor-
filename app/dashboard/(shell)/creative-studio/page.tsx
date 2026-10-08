import { createCreativeProject, listCreativeFolders, listCreativeProjects } from "@/app/actions/creative-studio";
import CreativeExplorer from "@/components/creative/CreativeExplorer";
import NewCreativeButton from "@/components/creative/NewCreativeButton";

export default async function CreativeStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  // Everything loads once, unfiltered — folder navigation happens client-side
  // in CreativeExplorer from here on, not through another server round trip.
  const [folders, projects] = await Promise.all([listCreativeFolders(), listCreativeProjects()]);

  async function createAction(formData: FormData) {
    "use server";
    await createCreativeProject(String(formData.get("title") ?? ""), String(formData.get("format") ?? ""));
  }

  return (
    <div className="flex h-full w-full flex-col px-2 py-3 sm:px-3">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fire">Creative Studio</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Layered creative projects
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-muted sm:text-sm">
            Static design and motion share one CreativeDocument. Every layer stays independently
            editable, animatable and renderable.
          </p>
        </div>
        <NewCreativeButton action={createAction} />
      </header>

      <section className="flex-1">
        <CreativeExplorer
          folders={folders as { id: string; name: string }[]}
          projects={
            projects as {
              id: string;
              title: string;
              status: string;
              folder_id: string | null;
              updated_at: string | null;
              size_bytes: number | null;
            }[]
          }
          initialFolderId={folder ?? null}
        />
      </section>
    </div>
  );
}
