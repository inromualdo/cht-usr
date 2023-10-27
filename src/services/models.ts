export type person = {
  id?: string;
  name: string;
  phone: string;
  sex: string;
  role: string;
};

export type place = {
  id?: string;
  name: string;
  type: string;
  contact: person;
  parent?: {
    id: string;
    name: string;
  };
  state?: {
    status: string;
  };
};

export type workBookState = {
  id: string;
  places: Map<string, place[]>;
};

export enum jobStatus {
  SUCCESS = "success",
  FAILURE = "failure",
  PENDING = "pending",
}
