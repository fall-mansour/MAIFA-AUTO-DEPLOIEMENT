const db = require('../db');
const bcrypt = require('bcrypt');

exports.getInscription = async (req, res) => {
    console.log("1. Requête reçue pour :", req.body.mail);

    const { prenom, nom, mail, password, adresse, telephone, marque_vehicule, modele_vehicule, annee } = req.body;

    try {
        // 2. Hachage du mot de passe
        console.log("2. Hachage du mot de passe...");
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Préparation SQL
        const sql = `
            INSERT INTO users
            (prenom, nom, mail, password, adresse, telephone, marque_vehicule, modele_vehicule, annee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // 4. Exécution SQL
        console.log("3. Envoi vers MySQL...");
        const [result] = await db.execute(sql, [
            prenom,
            nom,
            mail,
            hashedPassword,
            adresse || null,
            telephone || null,
            marque_vehicule || null,
            modele_vehicule || null,
            annee || null
        ]);

        console.log("4. MySQL a confirmé l'insertion. ID:", result.insertId);

        // 5. ENVOI DE LA RÉPONSE (Le moment où le bouton Angular se débloque)
        // Utilise bien 'return' pour être sûr que la fonction s'arrête ici.
        return res.status(201).json({
            success: true,
            message: "Bienvenue ! Votre compte a été créé avec succès."
        });

    } catch (error) {
        // 6. Gestion des erreurs (ex: email en double)
        console.error("ERREUR CRITIQUE :", error.message);

        // On répond avec un code d'erreur pour que le bouton Angular repasse à 'false'
        return res.status(500).json({
            success: false,
            message: "Erreur serveur : " + error.message
        });
    }
};
