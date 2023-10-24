import { AppSettings } from "./cht";

type person = {
  contactType: string;
  createForm: string;
};

type placeData = {
  createForm: string;
};

type place = {
  data: placeData;
  person?: person;
  parent?: string;
  children: string[];
};

export type Hierarchy = {
  [key: string]: place;
};

export const getHierarchy = (settings: AppSettings): Hierarchy => {
  const places: Hierarchy = {};
  settings.contactTypes.forEach((item) => {
    if (settings.hierarchyTypes.includes(item.id)) {
      places[item.id] = {
        data: { createForm: item.createForm },
        children: [],
        parent: item.parents?.[0],
      };
      item.parents?.forEach((parentId) => {
        const parent = places[parentId];
        parent.children.push(item.id);
        places[parentId] = parent;
      });
    } else {
      item.parents?.forEach((parentId) => {
        places[parentId].person = {
          contactType: item.id,
          createForm: item.createForm,
        };
      });
    }
  });
  return places;
};

export const getRoles = (settings: AppSettings): string[] => {
  return settings.roles;
};
