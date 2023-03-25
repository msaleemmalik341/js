const { get, filter, isEmpty, find } = require("lodash");
const db = require("@models/index").sequelize;
const { QueryTypes } = require("sequelize");
const {
  fetchUserQuery,
  generateReferralCode,
  makeUniqueString,
} = require("@utils");
const { transactions } = require("@constants/coinTransactions");
const { coinsTransaction } = require("./coinManager");
const bcrypt = require("bcryptjs");
const defaultStatus = {
  emailVerified: false,
  bioVerified: false,
  domainVerified: false,
  phoneNumberVerified: false,
  paymentVerified: false,
};
const referralCodes = require("voucher-code-generator");


/********************************

  CHEKING USER IS EXISTS OR NOT

  ********************************* */
const checkExistUser = async (emailAddress) => {
  try {
    return await db.query(
      ` SELECT EXISTS(SELECT "id" from users where "emailAddress" = '${emailAddress
        .toLowerCase()
        .trim()}')`,
      { type: QueryTypes.SELECT, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  FIND USER AND CREATE ITS BASE PROFILE FROM DATABASE AND IF
 NOT EXISTS THEN CREATE USER  AND CREATE ITS PROPFILE IN DATABASE

  ********************************* */
const findAndCreateUser = async ({
  emailAddress,
  password,
  verificationCode,
  roleType,
  referralCode = false,
}) => {
  try {
    const getUser = await db.query(
      ` INSERT INTO public."users" 
    ( "emailAddress", "userRole", "password", "provider","verificationCode", "referralCode", "domainVerificationCode","createdAt", "updatedAt") 
    VALUES('${emailAddress}', ${roleType}, '${bcrypt.hashSync(
        password,
        8
      )}', 'GENERIC', '${verificationCode}', '${generateReferralCode(
        emailAddress.split("@")[0]
      )}',${roleType == "2"
        ? `'${referralCodes.generate({
          postfix: Date.now(),
          charset: referralCodes.charset("alphanumeric"),
        })}'`
        : "NULL"
      },
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING "id" `,
      { type: QueryTypes.INSERT }
    );
    if (getUser) {
      if (getUser[0][0]) {
        await db.query(
          ` INSERT INTO public."userPreferences"
          (  "userId","status","createdAt", "updatedAt","customerPayableCoin","advertiserPayableCoin") 
          VALUES(${getUser[0][0].id},'${JSON.stringify(defaultStatus)}',
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,'20','50') RETURNING "id" `,
          { type: QueryTypes.INSERT }
        );
        if (roleType === "3") {
          const status = await coinsTransaction(
            getUser[0][0],
            get(transactions, "CUSTOMER_SELF_SIGNUP", false)
          );

          if (referralCode) {
            const status1 = await coinsTransaction(
              getUser[0][0],
              get(transactions, "CUSTOMER_REFERRAL_SIGNUP", false)
            );
            const referralUser = await fetchUser(
              `u."referralCode" = '${referralCode}'`
            );

            if (referralUser) {
              const status2 = coinsTransaction(
                referralUser,
                get(transactions, "CUSTOMER_INVITER", false)
              );
            }
          }
        }

        return await db.query(
          `${fetchUserQuery(`u.id = ${getUser[0][0].id}`)}`,
          { type: QueryTypes.SELECT, plain: true }
        );
      }
    }
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  FETCH USER FROM DATABASE ON MULTIPLE 
OR SIGNLE DYNAMIC CONDITIONS

  ********************************* */
const fetchUser = async (filter) => {
  try {
    return await db.query(`${fetchUserQuery(filter)} `, {
      type: QueryTypes.SELECT,
      plain: true,
    });
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  CHECK IF USER HAS SAME VERIIFCATION CODE THEN 
UPDATE USER VERIFICATION STATUS IN DATABASE

  ********************************* */
const updateUserVerificationCode = async (verificationCode) => {
  try {
    const response = await db.query(
      `UPDATE public."users" SET "verificationCode" = '${verificationCode}' WHERE "verificationCode"='${verificationCode}' RETURNING id
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
    await db.query(
      `UPDATE public."userPreferences" SET "status" = jsonb_set(status, '{emailVerified}', 'true')
      WHERE "userId"='${response[0].id}' 
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
    return db.query(`${fetchUserQuery(`u.id = ${response[0].id}`)} `, {
      type: QueryTypes.SELECT,
      plain: true,
    });
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  UPDATE USER PASSWORD IN DATABASE

  ********************************* */
const updateUserPassword = async (user, password) => {
  try {
    return await db.query(
      `UPDATE public."users" SET "password" = '${bcrypt.hashSync(password, 8)}'
      WHERE "emailAddress"='${user.emailAddress}' RETURNING *
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  UPDATE PHONE NUMBER INDATABSE ADN RETURN LATEST

  ********************************* */

const updatePhoneNumber = async (body) => {
  try {
    return await db.query(
      `UPDATE public."userPreferences" SET
      "phoneNumber"='${body.phoneNumber}',
      "status" = jsonb_set(status, '{phoneNumberVerified}', 'true')
      WHERE "userId" ='${body.user.id}' RETURNING "userId"
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  UPDATE USER PROFILE AND RETURN LATEST

  ********************************* */

const updateUserProfile = async (body) => {
  try {
    return await db.query(
      `UPDATE public."userPreferences" SET 
      "fullName"='${body.fullName}',
      "gender"='${body.gender}',
      "dob"='${body.dob}',
      "country"='${body.country}',
      "state"='${body.state}',
      "city"='${body.city}',
      "postalCode" ='${body.postalCode}',
      "status" = jsonb_set(status, '{bioVerified}', 'true')
      WHERE "userId"='${body.user.userId}' RETURNING "userId"
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  CREATE UNIQUE VERIFIACATION CODE AND SAVE IT AGAINST USER

  ********************************* */

const updateCode = async (emailAddress) => {
  try {
    const response = await db.query(
      `UPDATE public."users" SET "verificationCode" = '${makeUniqueString(
        process.env.VERIFICATION_TOKEN_LENGTH
      )}' WHERE "emailAddress"='${emailAddress}' RETURNING "id"
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
    return db.query(`${fetchUserQuery(`u.id = ${response[0].id}`)} `, {
      type: QueryTypes.SELECT,
      plain: true,
    });
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  HARD DELETE USER FROM DATABSE

  ********************************* */
const deleteUser = async (emailAddress) => {
  try {
    return await db.query(
      `DELETE FROM public."users" WHERE "emailAddress"='${emailAddress}'RETURNING id
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

/********************************

  HARD DELETE USER ACCOUNT. THIS METHOD IS FOR AN ADMIN

  ********************************* */
const deleteUserAccount = async (userId) => {
  try {
    return await db.query(
      `DELETE FROM public."users" WHERE "id"='${userId}'RETURNING id
      `,
      { type: QueryTypes.UPDATE, plain: true }
    );
  } catch (error) {
    throw error.stack;
  }
};

module.exports = {
  checkExistUser,
  findAndCreateUser,
  fetchUser,
  updateUserVerificationCode,
  updateUserPassword,
  updateUserProfile,
  deleteUser,
  deleteUserAccount,
  updateCode,
  updatePhoneNumber,
};
