import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { Insights } from "./Insights";
import { Library } from "./Library";
import { NewProject } from "./NewProject";
import { Studio } from "./Studio";
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
  let shell = "";
  if (page === "new") body = <NewProject />;
  else if (page === "library") body = <Library />;
  else if (page === "insights") body = <Insights />;
  else if (page === "p" && name && sub === "add") body = <NewProject addTo={name} />;
  else if (page === "p" && name && sub === "edit") { body = <Editor key={name} name={name} />; shell = "wide"; }
  else if (page === "p" && name) { body = <Studio key={name} name={name} jobId={sub === "job" ? id : undefined} />; shell = "full"; }
  else body = <Home />;
  const on = (p: string) => (page === p || (!page && p === "") ? "on" : "");
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">Adam <b>Studio</b></a>
        <nav className="nav">
          <a className={on("") || (page === "p" ? "on" : "")} href="#/">Projects</a>
          <a className={on("library")} href="#/library">Library</a>
          <a className={on("insights")} href="#/insights">Insights</a>
        </nav>
      </header>
      <main className={shell}>{body}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
