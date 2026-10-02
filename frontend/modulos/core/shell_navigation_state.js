export function entranceModule(navigation, saved) {
    return navigation.some(item => item.id === saved) ? saved : navigation.find(item => item.default)?.id || navigation[0]?.id;
}
