import {
  createPerson,
  createPlace,
  createUser,
  Credentials,
  PersonPayload,
  PlacePayload,
  PlaceSearchResult,
  searchPlace,
  UserPayload,
} from "../lib/cht";
import { Hierarchy } from "./app_settings";

type person = {
  name: string;
  phone: string;
  sex: string;
  role: string;
};

export type place = {
  id: string;
  name: string;
  type: string;
  contact: person;
  parent?: {
    id: string;
    name: string;
  };
};

type workflowState = {
  [key: string]: place[] | undefined;
};

type workbookState = {
  [key: string]: workflowState;
};

type state = {
  creds?: Credentials;
  hierarchy?: Hierarchy;
  userRoles?: string[];
  workbooks: workbookState;
};

let cache: state;

export const initAppState = (
  creds: Credentials,
  hierarchy: Hierarchy,
  roles: string[]
) => {
  cache = {
    creds: creds,
    userRoles: roles,
    hierarchy: hierarchy,
    workbooks: {},
  };
};

export const initWorkbook = (name: string): string => {
  const places = Object.keys(cache.hierarchy!!).filter(
    (key) => !cache.hierarchy!![key].parent
  );
  const active = places[0];
  const workflowState: workflowState = {};
  workflowState[active] = [];
  const id = name.toLowerCase().split(" ").join("");
  cache.workbooks[id] = workflowState;
  return id;
};

export const getWorkbooks = (): string[] => {
  return Object.keys(cache.workbooks);
};

const getWorkbookState = (name: string): workflowState => {
  return cache!!.workbooks[name];
};

export const addPlace = (workbook: string, data: place) => {
  const places = getWorkbookState(workbook)!![data.type] || [];
  places.push(data);
  getWorkbookState(workbook)!![data.type] = places;
};

export const getPlaces = (workbook: string): place[] => {
  const places: place[] = [];
  Object.keys(getWorkbookState(workbook)).forEach((page) => {
    const data = getWorkbookState(workbook)[page] || [];
    places.push(...data);
  });
  return places;
};

export const getUserRoles = (): string[] => {
  return cache!!.userRoles!!;
};

export const getPlaceTypes = (): string[] => {
  return Object.keys(cache!!.hierarchy!!);
};

export const getParentType = (placeType: string): string | undefined => {
  return cache!!.hierarchy!![placeType].parent;
};

type idMap = {
  [key: string]: string | undefined;
};
const placeIds: idMap = {};

const buildUserPayload = (
  placeId: string,
  contactId: string,
  contactName: string,
  role: string
): UserPayload => {
  const data: UserPayload = {
    username: contactName.toLowerCase().split(" ").join("_"),
    password: "medic@1234!",
    type: role,
    place: placeId,
    contact: contactId,
  };
  return data;
};

const buildPersonPayload = (person: person, placeId: string): PersonPayload => {
  const data: PersonPayload = {
    name: person.name,
    phone: person.phone,
    sex: person.sex,
    type: "contact",
    contact_type: "person",
    place: placeId,
  };
  return data;
};

const buildPlacePayload = (place: place): PlacePayload => {
  const data: PlacePayload = {
    name: place.name,
    type: "contact",
    contact_type: place.type,
  };
  if (place.parent) {
    data.parent = placeIds[place.parent.id];
  }
  return data;
};

type searchResultCache = {
  [key: string]: PlaceSearchResult;
};
const remotePlaceCache: searchResultCache = {};

export const findPlace = async (
  workbookId: string,
  placeType: string,
  searchStr: string
): Promise<PlaceSearchResult[]> => {
  const localResults = getPlaces(workbookId)
    .filter((place) => place.name.includes(searchStr))
    .map((place) => {
      return { id: place.id, name: place.name };
    });
  const remoteResults = await searchPlace(cache.creds!!, placeType, searchStr);

  const results: PlaceSearchResult[] = localResults.concat(remoteResults);
  results.forEach((place) => {
    remotePlaceCache[place.id] = place;
  });

  return results;
};

export const getPlace = (id: string): PlaceSearchResult => {
  return remotePlaceCache[id];
};

const submitWorkbook = async (workbook: string) => {
  for (const placeType of Object.keys(getWorkbookState(workbook)!!)) {
    const places = getWorkbookState(workbook)!![placeType];
    for (const place of places!!) {
      const placePayload = buildPlacePayload(place);
      if (placeIds[place.id]) {
        continue;
      }
      const placeId = await createPlace(cache.creds!!, placePayload);
      placeIds[place.id] = placeId;
      const contactId = await createPerson(
        cache.creds!!,
        buildPersonPayload(place.contact, placeId)
      );
      await createUser(
        cache.creds!!,
        buildUserPayload(
          placeId,
          contactId,
          place.contact.name,
          place.contact.role
        )
      );
    }
  }
};
