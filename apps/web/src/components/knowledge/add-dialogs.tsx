"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useFolders, useKnowledgeMutations } from "@/lib/api/hooks/knowledge";
import { parseTags } from "@/components/productivity/meta";

const NONE = "__none__";

function FolderSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useFolders();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No folder</SelectItem>
        {(data?.items ?? []).map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SaveUrlDialog({ open, onOpenChange, defaultFolder }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFolder?: string | null }) {
  const { create } = useKnowledgeMutations();
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState(defaultFolder ?? NONE);
  const [tags, setTags] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ mode: "url", url: url.trim(), folder_id: folder === NONE ? null : folder, tags: parseTags(tags) });
    setUrl("");
    setTags("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Save a link</DialogTitle>
            <DialogDescription>Articles, GitHub repositories, arXiv / Hugging Face papers and documentation pages are imported and indexed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="kv-url">URL</Label>
            <Input id="kv-url" type="url" required autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Folder</Label>
              <FolderSelect value={folder} onChange={setFolder} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kv-tags">Tags</Label>
              <Input id="kv-tags" placeholder="rag, postgres" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !url.trim()}>
              {create.isPending && <Spinner />} {create.isPending ? "Importing…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NoteDialog({ open, onOpenChange, defaultFolder }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFolder?: string | null }) {
  const { create } = useKnowledgeMutations();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folder, setFolder] = useState(defaultFolder ?? NONE);
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<"note" | "documentation">("note");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await create.mutateAsync({ mode: "note", type: kind, title: title.trim(), content, folder_id: folder === NONE ? null : folder, tags: parseTags(tags) });
    setTitle("");
    setContent("");
    setTags("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
            <DialogDescription>Markdown supported. Notes are embedded so the assistant can answer questions about them.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label htmlFor="note-title">Title</Label>
              <Input id="note-title" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="documentation">Documentation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-content">Content</Label>
            <Textarea id="note-content" required rows={12} className="font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Folder</Label>
              <FolderSelect value={folder} onChange={setFolder} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-tags">Tags</Label>
              <Input id="note-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !title.trim() || !content.trim()}>
              {create.isPending && <Spinner />} Save note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
