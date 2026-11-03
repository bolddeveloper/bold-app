import {Component, createRef} from "react";

export class SectionCollapse extends Component {
    state = {present: this.props.open};
    container = createRef();
    settle = () => {
        this.animation?.cancel();
        this.animation = null;
        this.container.current.style.overflow = this.props.open ? "" : "hidden";
        if (this.state.present !== this.props.open) this.setState({present: this.props.open});
    };
    preferenceChanged = () => { if (this.preference.matches) this.settle(); };

    componentDidMount() {
        this.preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.preference.addEventListener("change", this.preferenceChanged);
    }

    getSnapshotBeforeUpdate(previous) {
        return previous.open !== this.props.open ? this.container.current.getBoundingClientRect().height : null;
    }

    componentDidUpdate(previous, state, height) {
        if (height === null) return;
        const element = this.container.current;
        this.animation?.cancel();
        if (this.preference.matches || !element.animate) { this.settle(); return; }
        if (this.props.open && !this.state.present) this.setState({present: true});
        const target = element.getBoundingClientRect().height;
        element.style.overflow = "hidden";
        this.animation = element.animate([{height: `${height}px`}, {height: `${target}px`}],
            {duration: this.props.open ? 280 : 220, easing: "cubic-bezier(.22,1,.36,1)"});
        this.animation.onfinish = this.settle;
    }

    componentWillUnmount() {
        this.animation?.cancel();
        this.preference.removeEventListener("change", this.preferenceChanged);
    }

    render() {
        const {open, children} = this.props;
        return <div ref={this.container} className="task_section_collapse" style={{height: open ? "auto" : 0, overflow: open ? undefined : "hidden"}} inert={!open} aria-hidden={!open}>
            <div className="task_section_content">{(open || this.state.present) && children()}</div>
        </div>;
    }
}

// Capture before React reorders the DOM so completion never waits for motion.
export class TaskMotion extends Component {
    container = createRef();
    animations = new Set();
    clearDropTarget = () => {
        if (this.dropTarget) delete this.dropTarget.dataset.taskDrop;
        this.dropTarget = null;
    };
    dragStart = event => {
        this.clearDropTarget();
        const card = event.target.closest?.('[data-task-id]');
        this.sourceSection = card?.draggable ? card.closest('.task_group,.board_column') : null;
        this.props.onDragStartCapture?.(event);
    };
    dragOver = event => {
        const section = event.target.closest?.('.task_group,.board_column');
        const target = this.sourceSection && section !== this.sourceSection && this.container.current.contains(section) ? section : null;
        if (target !== this.dropTarget) {
            this.clearDropTarget();
            this.dropTarget = target;
            if (target) target.dataset.taskDrop = "true";
        }
        this.props.onDragOverCapture?.(event);
    };
    dragLeave = event => {
        if (this.dropTarget) {
            const rect = this.dropTarget.getBoundingClientRect();
            const outside = event.relatedTarget ? !this.dropTarget.contains(event.relatedTarget)
                : event.clientX < rect.left || event.clientX >= rect.left + rect.width || event.clientY < rect.top || event.clientY >= rect.top + rect.height;
            if (outside) this.clearDropTarget();
        }
        this.props.onDragLeaveCapture?.(event);
    };
    dragFinish = event => {
        this.clearDropTarget();
        this.sourceSection = null;
        if (event.type === "drop") this.props.onDropCapture?.(event);
        else this.props.onDragEndCapture?.(event);
    };
    cancelMotion = () => {
        for (const animation of this.animations) animation.cancel();
        this.animations.clear();
    };

    componentDidMount() {
        this.preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.preference.addEventListener("change", this.cancelMotion);
    }

    getSnapshotBeforeUpdate(previous) {
        if (previous.motionKey === this.props.motionKey || this.preference.matches) return null;
        const positions = new Map();
        this.container.current.querySelectorAll("[data-task-id]").forEach(element => {
            const rect = element.getBoundingClientRect();
            if (rect.width && rect.height) positions.set(element.dataset.taskId, rect);
        });
        return positions;
    }

    componentDidUpdate(previous, state, positions) {
        if (!positions) return;
        this.cancelMotion();
        const moves = [];
        this.container.current.querySelectorAll("[data-task-id]").forEach(element => {
            const before = positions.get(element.dataset.taskId);
            const after = element.getBoundingClientRect();
            if (!before || !after.width || !after.height || !element.animate) return;
            const x = before.left - after.left, y = before.top - after.top;
            if (x || y) moves.push({element, x, y});
        });
        for (const {element, x, y} of moves) {
            const animation = element.animate(
                [{translate: `${x}px ${y}px`}, {translate: "none"}],
                {duration: 320, easing: "cubic-bezier(.22,1,.36,1)"}
            );
            this.animations.add(animation);
            animation.onfinish = animation.oncancel = () => this.animations.delete(animation);
        }
    }

    componentWillUnmount() {
        this.preference.removeEventListener("change", this.cancelMotion);
        this.cancelMotion();
    }

    render() {
        const {motionKey, children, ...props} = this.props;
        return <div {...props} ref={this.container} onDragStartCapture={this.dragStart} onDragOverCapture={this.dragOver} onDragLeaveCapture={this.dragLeave} onDropCapture={this.dragFinish} onDragEndCapture={this.dragFinish}>{children}</div>;
    }
}
