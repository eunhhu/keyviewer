import { createSignal, onMount, lazy, Suspense } from "solid-js";
import "./App.css";

const Config = lazy(() => import("./Config"));
const Overlay = lazy(() => import("./Overlay"));

function App() {
  const [route, setRoute] = createSignal(window.location.hash);

  onMount(() => {
    const onHashChange = () => {
      setRoute(window.location.hash);
      if (window.location.hash === "#/overlay") {
        document.body.classList.add("is-overlay");
      } else {
        document.body.classList.remove("is-overlay");
      }
    };
    
    onHashChange();
    
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  });

  return (
    <Suspense fallback={<div class="loading">Loading...</div>}>
      {route() === "#/overlay" ? <Overlay /> : <Config />}
    </Suspense>
  );
}

export default App;
