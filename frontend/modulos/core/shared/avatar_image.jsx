import {CachedImage} from "./cached_image.jsx";
import { useState } from "react";
import "./avatar_image.css";

export function AvatarImage({ url, initials }) {
    const [failed, setFailed] = useState(null);
    return url && failed !== url ? <CachedImage className="bold_avatar_image" src={url} alt="" onError={() => setFailed(url)} /> : initials;
}
