import axios from "axios";

export type contactConf = {
  id: string;
  createForm: string;
  parents?: string[];
};

export type AppSettings = {
  hierarchyTypes: string[];
  roles: string[];
  contactTypes: contactConf[];
};

export type Credentials = {
  User: string;
  Pass: string;
  Domain: string;
};

export const getAppSettings = async (
  creds: Credentials
): Promise<AppSettings> => {
  const url = `https://${creds.User}:${creds.Pass}@${creds.Domain}/medic/_design/medic/_rewrite/app_settings/medic`;
  const resp = await axios.get(url);
  if (resp.status !== 200) {
    throw new Error(`could not get app settings: ${resp.statusText}`);
  }
  const { settings: respBody } = resp.data;
  return {
    hierarchyTypes: respBody["place_hierarchy_types"],
    roles: Object.keys(respBody["roles"]),
    contactTypes: respBody["contact_types"].map((item: any) => {
      return {
        id: item.id,
        createForm: item.create_form,
        parents: item.parents,
      };
    }),
  };
};

export type PersonPayload = {
  name: string;
  phone: string;
  sex: string;
  type: string;
  contact_type: string;
  place: string;
};

export type PlacePayload = {
  name: string;
  type: string;
  contact_type: string;
  parent?: string;
};

export type UserPayload = {
  password: string;
  username: string;
  type: string;
  place: string;
  contact: string;
};

// we only get the place id back
export const createPerson = async (
  creds: Credentials,
  person: PersonPayload
): Promise<string> => {
  const url = `https://${creds.User}:${creds.Pass}@${creds.Domain}/api/v1/people`;
  const resp = await axios.post(url, person);
  if (resp.status !== 200) {
    throw new Error(`could not create place: ${resp.statusText}`);
  }
  return resp.data.id;
};

// we only get the place id back
export const createPlace = async (
  creds: Credentials,
  place: PlacePayload
): Promise<string> => {
  const url = `https://${creds.User}:${creds.Pass}@${creds.Domain}/api/v1/places`;
  const resp = await axios.post(url, place);
  if (resp.status !== 200) {
    throw new Error(`could not create place: ${resp.statusText}`);
  }
  return resp.data.id;
};

// we only get the user and contact id back
export const createUser = async (
  creds: Credentials,
  user: UserPayload
): Promise<void> => {
  const url = `https://${creds.User}:${creds.Pass}@${creds.Domain}/api/v1/users`;
  const resp = await axios.post(url, user);
  if (resp.status !== 200) {
    throw new Error(`could not create users: ${resp.statusText}`);
  }
};

export type PlaceSearchResult = {
  id: string;
  name: string;
};

export const searchPlace = async (
  creds: Credentials,
  placeType: string,
  searchStr: string
): Promise<PlaceSearchResult[]> => {
  const url = `https://${creds.User}:${creds.Pass}@${creds.Domain}/medic/\_find`;
  const resp = await axios.post(url, {
    selector: {
      contact_type: placeType,
      name: {
        $regex: `^(?i)${searchStr}`,
      },
    },
  });
  if (resp.status !== 200) {
    throw new Error(`search failed: ${resp.statusText}`);
  }
  const { docs } = resp.data;
  return docs.map((doc: any) => {
    return { id: doc._id, name: doc.name };
  });
};
