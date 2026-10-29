"""Small, explicit rich-text contract; offsets on the wire are UTF-16 (Yjs)."""
from urllib.parse import urlsplit
from rest_framework.exceptions import ValidationError

MARKS={'bold','italic','strike','code','no_link'}
TEXT_TYPES={'paragraph','heading','bullet','check'}
LANGUAGES=('text','javascript','typescript','python','sql','json','html','css','bash')


def boundaries(text):
    result={0:0};units=bytes_=0
    try:
        for char in text:
            units+=len(char.encode('utf-16-le'))//2
            bytes_+=len(char.encode('utf-8'))
            result[units]=bytes_
    except UnicodeError:
        raise ValidationError('El texto contiene un carácter Unicode no válido.')
    return result


def safe_href(value):
    if not isinstance(value,str) or not value or len(value)>2048 or any(ord(char)<=32 or ord(char)==127 for char in value) or '\\' in value:
        raise ValidationError('El enlace admite hasta 2.048 caracteres, sin espacios ni controles.')
    try:
        parts=urlsplit(value)
        if parts.scheme.lower() not in ('http','https') or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError()
        parts.port
    except ValueError:
        raise ValidationError('Usa un enlace http o https válido, sin credenciales.')
    return value


def attributes(value):
    if not isinstance(value,dict) or set(value)-(MARKS|{'href'}):
        raise ValidationError('El formato contiene atributos no admitidos.')
    result={}
    for key in sorted(value):
        if key=='href':result[key]=safe_href(value[key])
        elif value[key] is True:result[key]=True
        else:raise ValidationError('Las marcas de formato deben ser verdaderas u omitirse.')
    return result


def validate_formats(text,values):
    if not isinstance(values,list) or len(values)>200:
        raise ValidationError('Cada bloque admite hasta 200 tramos de formato.')
    points=boundaries(text);result=[];previous=0
    for row in values:
        if not isinstance(row,dict) or not {'start','end'}<=set(row):
            raise ValidationError('Tramo de formato no válido.')
        start,end=row['start'],row['end']
        if type(start) is not int or type(end) is not int or start not in points or end not in points or start<previous or start>=end:
            raise ValidationError('Los formatos deben estar ordenados, sin solaparse ni dividir caracteres.')
        attrs=attributes({key:value for key,value in row.items() if key not in ('start','end')})
        if not attrs:raise ValidationError('El tramo necesita al menos un formato.')
        if result and result[-1]['end']==start and {k:v for k,v in result[-1].items() if k not in ('start','end')}==attrs:
            result[-1]['end']=end
        else:result.append({'start':start,'end':end,**attrs})
        previous=end
    return result


def read_text(shared,*,plain=False):
    from pycrdt import Text
    if not isinstance(shared,Text):raise ValidationError('El texto debe conservar su tipo colaborativo.')
    chunks=[];formats=[];offset=0
    for value,raw in shared.diff():
        if not isinstance(value,str):raise ValidationError('No se admiten objetos incrustados en el texto.')
        attrs=attributes(raw or {})
        if plain and attrs:raise ValidationError('Este campo no admite formato enriquecido.')
        end=offset+max(boundaries(value))
        if attrs and end>offset:formats.append({'start':offset,'end':end,**attrs})
        chunks.append(value);offset=end
    text=''.join(chunks)
    return text,validate_formats(text,formats)


def seed_formats(shared,text,formats):
    # pycrdt's Python editing API uses UTF-8 byte offsets; Yjs clients use UTF-16.
    points=boundaries(text)
    for row in validate_formats(text,formats):
        shared.format(points[row['start']],points[row['end']],{key:value for key,value in row.items() if key not in ('start','end')})


def mention_text(block):
    text=block.get('text','')
    if block.get('type')=='code':return ''
    encoded=text.encode('utf-16-le');parts=[];offset=0
    for row in block.get('formats',[]):
        if not row.get('code'):continue
        start,end=row['start']*2,row['end']*2
        parts.extend((encoded[offset:start].decode('utf-16-le'),' '*len(encoded[start:end].decode('utf-16-le'))));offset=end
    parts.append(encoded[offset:].decode('utf-16-le'))
    return ''.join(parts)
