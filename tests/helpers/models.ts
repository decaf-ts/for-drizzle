import {
  email,
  min,
  minlength,
  model,
  ModelArg,
  pattern,
  required,
} from "@decaf-ts/decorator-validation";
import {
  BaseModel,
  Cascade,
  index,
  oneToMany,
  oneToOne,
  OrderDirection,
  pk,
} from "@decaf-ts/core";
import { prop } from "@decaf-ts/decoration";

@model()
export class TestCountryModel extends BaseModel {
  @pk({ type: Number })
  @index([OrderDirection.ASC, OrderDirection.DSC])
  id!: number;

  @required()
  name!: string;

  @required()
  countryCode!: string;

  @required()
  @pattern(/[a-z]{2}(?:_[A-Z]{2})?/g)
  locale!: string;

  constructor(m?: ModelArg<TestCountryModel>) {
    super(m);
  }
}

@model()
export class TestAddressModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  street!: string;

  @required()
  doorNumber!: string;

  @prop()
  apartmentNumber?: string;

  @required()
  areaCode!: string;

  @required()
  city!: string;

  @oneToOne(TestCountryModel, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  @required()
  country!: TestCountryModel;

  constructor(m?: ModelArg<TestAddressModel>) {
    super(m);
  }
}

@model()
export class TestPhoneModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  areaCode!: string;

  @required()
  number!: string;

  constructor(m?: ModelArg<TestPhoneModel>) {
    super(m);
  }
}

@model()
export class TestUserModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  @index()
  name!: string;

  @required()
  @email()
  @index()
  email!: string;

  @required()
  @min(18)
  @index()
  age!: number;

  @oneToOne(TestAddressModel, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  @required()
  address!: TestAddressModel;

  @oneToMany(TestPhoneModel, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  @required()
  @minlength(1)
  phones!: TestPhoneModel[];

  constructor(m?: ModelArg<TestUserModel>) {
    super(m);
  }
}

@model()
export class TestDummyCountry extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  @required()
  countryCode!: string;

  constructor(m?: ModelArg<TestDummyCountry>) {
    super(m);
  }
}

@model()
export class NoPopulateOnceModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @oneToOne(
    TestDummyCountry,
    { update: Cascade.CASCADE, delete: Cascade.CASCADE },
    false
  )
  @required()
  country!: TestDummyCountry;

  constructor(m?: ModelArg<NoPopulateOnceModel>) {
    super(m);
  }
}

@model()
export class TestDummyPhone extends BaseModel {
  @pk({ type: Number })
  id!: number;
  @required()
  areaCode!: string;
  @required()
  number!: string;

  constructor(m?: ModelArg<TestDummyPhone>) {
    super(m);
  }
}

@model()
export class NoPopulateManyModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  @index()
  name!: string;

  @oneToMany(
    TestDummyPhone,
    { update: Cascade.CASCADE, delete: Cascade.CASCADE },
    false
  )
  @required()
  @minlength(1)
  phones!: TestDummyPhone[];

  constructor(m?: ModelArg<NoPopulateManyModel>) {
    super(m);
  }
}

export function testCountry(country: TestCountryModel) {
  expect(country).toBeDefined();
  expect(country).toBeInstanceOf(TestCountryModel);
  expect(country.id).toBeDefined();
  expect(country.createdAt).toBeDefined();
  expect(country.updatedAt).toBeDefined();
}

export function testAddress(address: TestAddressModel) {
  expect(address).toBeDefined();
  expect(address).toBeInstanceOf(TestAddressModel);
  expect(address.id).toBeDefined();
  expect(address.createdAt).toBeDefined();
  expect(address.updatedAt).toBeDefined();
  testCountry(address.country as TestCountryModel);
}

export function testPhone(p: TestPhoneModel) {
  expect(p).toBeInstanceOf(TestPhoneModel);
  expect(p.id).toBeDefined();
  expect(p.createdAt).toBeDefined();
  expect(p.updatedAt).toBeDefined();
}

export function testUser(user: TestUserModel) {
  expect(user).toBeDefined();
  expect(user).toBeInstanceOf(TestUserModel);
  expect(user.id).toBeDefined();
  expect(user.createdAt).toBeDefined();
  expect(user.updatedAt).toBeDefined();

  const { address, phones } = user as TestUserModel;

  testAddress(address as TestAddressModel);

  expect(phones).toBeDefined();
  expect(phones.length).toBeGreaterThan(1);
  phones.forEach((p) => testPhone(p));
}
