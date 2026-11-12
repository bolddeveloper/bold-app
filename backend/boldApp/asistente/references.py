from rest_framework.exceptions import ValidationError


class AmbiguousReference(ValidationError):
    def __init__(self,message,sources):
        self.sources=sources
        super().__init__(message)


def resolve(value,previous,sources):
    if isinstance(value,dict):
        if '$source' in value:
            index=value['$source'];field=value.get('field','id')
            if set(value)-{'$source','field'} or type(index) is not int or not 0<=index<len(previous) or field not in {'id','ids'}:
                raise ValidationError('Una referencia de consulta debe apuntar a una fuente anterior y a sus identificadores.')
            data=previous[index]['data']
            rows=data.get('results',[]) if isinstance(data,dict) else data if isinstance(data,list) else []
            if isinstance(data,dict) and data.get('id'):rows=[data]
            ids=[str(row['id']) for row in rows if isinstance(row,dict) and row.get('id')]
            partial=isinstance(data,dict) and data.get('partial')
            if partial or not ids or field=='id' and len(set(ids))!=1:
                labels=[(row.get('name') or row.get('title') or 'Registro')+(' · '+row['department'] if row.get('department') else '') for row in rows[:8]]
                detail='No hay una coincidencia única. Precisa el nombre y el departamento o proyecto.'
                if labels:detail+=' Coincidencias autorizadas: '+', '.join(labels)+'.'
                raise AmbiguousReference(detail,sources)
            return ids[0] if field=='id' else ids
        return {key:resolve(item,previous,sources) for key,item in value.items()}
    if isinstance(value,list):return [resolve(item,previous,sources) for item in value]
    return value
