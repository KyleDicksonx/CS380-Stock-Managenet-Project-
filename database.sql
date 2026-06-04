CREATE TABLE Users(
    UserID int primary key NOT NULL,
    Username varchar(40) NOT NULL,
    PasswordHash varchar(64) NOT NULL
);

CREATE TABLE Products(
    ProductID int primary key NOT NULL,
    Stock int NOT NULL
);

INSERT INTO Users(UserID, Username, PasswordHash)
VALUES (1, 'Tester001', SHA2('P@ssw0rd123', 256));

SELECT * FROM Users;

DELETE FROM Users WHERE UserID = 1;
