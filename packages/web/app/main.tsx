import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { Insights } from "./Insights";
import { Library } from "./Library";
import { NewProject } from "./NewProject";
import { Project } from "./Project";
import "./style.css";

function useHash(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => { const on = () => setParts(read()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  return parts;
}

function App() {
  const [page, name, sub, id] = useHash();
  let body;
  if (page === "new") body = <NewProject />;
  else if (page === "library") body = <Library />;
  else if (page === "insights") body = <Insights />;
  else if (page === "p" && name && sub === "add") body = <NewProject addTo={name} />;
  else if (page === "p" && name && sub === "edit") body = <Editor key={name} name={name} />;
  else if (page === "p" && name) body = <Project key={name} name={name} jobId={sub === "job" ? id : undefined} />;
  else body = <Home />;
  return (
    <>
      <header className="row"><a href="#/">Adam Studio</a><a href="#/library" style={{ fontWeight: 400 }}>Library</a><a href="#/insights" style={{ fontWeight: 400 }}>Insights</a></header>
      <main className={page === "p" && sub === "edit" ? "wide" : ""}>{body}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
