import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {TaskTextEditor, TaskText} from "../modulos/tareas/src/task_text_editor.jsx";
import {RenderBoardCard} from "virtual:bold-board-preview.jsx";
import "../modulos/tareas/src/styles.css";
import "../modulos/core/app_shell.css";
function Fixture() {
    const [value, setValue] = useState("");
    const tasks = [{id: "fixture", title: "Revisión de tarjeta y textos largos", priority: "Media", due_label: "14 oct 2026", description: "Notas del proyecto: https://drive.google.com/drive/folders/" + "x".repeat(100)}, {id: "fixture2", title: "Título " + "largo".repeat(45), priority: "Alta", due_label: "14 oct 2026", description: "Descripción corta"}];
    return <main style={{padding: 24, maxWidth: 1000, margin: "auto"}}><h1>Prueba local de comentarios y tablero</h1><TaskTextEditor label="Comentario" value={value} onChange={setValue} compact/><TaskText value={value}/><div className="board_view" style={{marginTop: 20}}>{["Sección de prueba", "Otra sección"].map((name, i) => <section className="board_column" key={name}><header><h2>{name}</h2></header><div className="board_card_stack">{tasks.map(task => <RenderBoardCard key={task.id} task_item={{...task, id: task.id + i}} handle_task_select={() => {}} handle_toggle_task={() => {}}/>)}</div></section>)}</div></main>;
}
if (new URLSearchParams(location.search).has("dark")) document.documentElement.classList.add("theme_dark");
createRoot(document.getElementById("root")).render(<Fixture/>);
