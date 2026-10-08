import re
from pathlib import PurePosixPath
from tempfile import SpooledTemporaryFile
from zipfile import ZipFile, ZIP_DEFLATED

from rest_framework.exceptions import PermissionDenied, ValidationError
from .service import MIMES, google, file_id

OFFICE_EXPORTS = {
    MIMES["docs"]: ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    MIMES["sheets"]: ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    MIMES["slides"]: ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
}


def archive_name(value):
    return re.sub(r'[\\/\x00-\x1f<>:"|?*]', "_", value or "Carpeta").strip(" .")[:180] or "Carpeta"


def folder_archive(user, root):
    # ponytail: ZIP preparation is synchronous; move large exports to a background job if requests time out.
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    names = set()

    def request(path, **kwargs):
        return google(user, "GET", path, **kwargs)

    def unique(parent, name):
        candidate, number = parent + name, 1
        base = PurePosixPath(name)
        while candidate.casefold() in names:
            number += 1
            candidate = f"{parent}{base.stem} ({number}){base.suffix}"
        names.add(candidate.casefold())
        return candidate

    try:
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            root_path = archive_name(root["name"]) + "/"
            archive.writestr(root_path, b"")
            stack = [(root["id"], root_path, {root["id"]})]
            while stack:
                identity, parent, ancestors = stack.pop()
                page, pages = "", set()
                while True:
                    result = request("/files", params={"q": f"'{file_id(identity)}' in parents and trashed = false", "pageSize": 100,
                        "fields": "nextPageToken,incompleteSearch,files(id,name,mimeType,size,capabilities)",
                        "supportsAllDrives": "true", "includeItemsFromAllDrives": "true", "pageToken": page})
                    if result.get("incompleteSearch"):
                        raise ValidationError("Google no devolvió toda la carpeta. Reintenta la descarga.")
                    for item in result.get("files", []):
                        mime, name = item["mimeType"], archive_name(item["name"])
                        if mime == MIMES["folder"]:
                            if item["id"] in ancestors:
                                raise ValidationError("La estructura de carpetas contiene una referencia circular.")
                            path = unique(parent, name) + "/"
                            archive.writestr(path, b"")
                            stack.append((item["id"], path, ancestors | {item["id"]}))
                            continue
                        if not item.get("capabilities", {}).get("canDownload"):
                            raise PermissionDenied(f"No tienes permiso para descargar «{item['name']}». No se creó un ZIP incompleto.")
                        path = "/files/" + file_id(item["id"])
                        if mime in OFFICE_EXPORTS:
                            extension, export_mime = OFFICE_EXPORTS[mime]
                            name += "." + extension
                            content = request(path + "/export", params={"mimeType": export_mime}, raw=True).content
                        elif mime.startswith("application/vnd.google-apps."):
                            raise ValidationError(f"«{item['name']}» requiere descargarse desde Google Drive.")
                        else:
                            content = request(path, params={"alt": "media", "supportsAllDrives": "true"}, raw=True).content
                        archive.writestr(unique(parent, name), content)
                    page = result.get("nextPageToken")
                    if not page:
                        break
                    if page in pages:
                        raise ValidationError("Google repitió una página de la carpeta. Reintenta la descarga.")
                    pages.add(page)
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise
