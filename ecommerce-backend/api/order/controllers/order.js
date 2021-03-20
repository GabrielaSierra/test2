'use strict';
const {sanitizeEntity} = require("strapi-utils")
const stripe = require("stripe")(process.env.STRIPE_SK)


/**
 * Stripe doesnt accept decimals, just integers
 * Given a price amount in decimals, return the amount in integer i.e cents 
 * @param {number} number 
 */
const fromDecimalToInt = (number) => parseInt(number*100)

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/concepts/controllers.html#core-controllers)
 * to customize this controller
 */

// we add this code to make sure a user can only see their orders and not all orders, this avoids an illegal invasion of privacy



module.exports = {
/**
 * Only return orders that belong to the logged in user
 * @param {any} ctx 
 */
    async find(ctx){
        const {user} = ctx.state //this is the magic user
        let entities

        if(ctx.query._q){
            entities = await strapi.services.order.search({...ctx.query, user: user.id})
        } else{
            entities = await strapi.services.order.find({...ctx.query, user: user.id})
        }

        return entities.map(entity => sanitizeEntity(entity, {model: strapi.models.order}))
    },
/**
 * Return one order, as long as it belongs to the logged in user
 * @param {any} ctx 
 */
    async findOne(ctx){
        const {id} = ctx.params
        const {user} = ctx.state

        const entity = await strapi.services.order.findOne({id, user: user.id})
        return sanitizeEntity(entity, {model: strapi.models.order})
    },

    /**
     * 
     * Creates a copy of the order 
     * and send it up on the Stripe Checkout session on the frontend
     * Here we pull all the data we need and store it in variables, write http requests and errors
     * @param {*} ctx 
     */

    async create(ctx){
        const {product} =ctx.request.body
        if(!product){
            return ctx.throw(400, "Please specify a product")
        }
        const realProduct = await strapi.services.product.findOne({id: product.id})
        if(!realProduct){
            return ctx.throw(404, "No product with that id")
        }

        const {user} = ctx.state

        const BASE_URL = ctx.request.headers.origin || "http://localhost:3000"

        const session = await stripe.checkout.sessions.create({
            payment_method_types : ["card"],
            customer_email: user.email,
            mode: "payment",
            success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: BASE_URL, 
            line_items: [
                {
                price_data:{
                    currency: "usd",
                    product_data: {
                        name: realProduct.name
                    },
                    // stripe doesnt accept decimals, just integers
                    unit_amount: fromDecimalToInt(realProduct.price)
                },
                quantity: 1
            }
        ]

        })

        //Create the order
        const newOrder = await strapi.services.order.create({
            user: user.id,
            product: realProduct.id,
            total: realProduct.price,
            status: "unpaid",
            checkout_session: session.id
        })

        return { id: session.id }
    },
/**
 * Given a checkout_Session, this async function verifies payment and updates the order
 * @param {any} ctx 
 */
    // confirming the order id/ checkout session directly via the stripe SDK
    async confirm(ctx){
        const {checkout_session} = ctx.request.body

        const session = await stripe.checkout.sessions.retrieve(checkout_session)

        if(session.payment_status==="paid"){
            const updateOrder = await strapi.services.order.update({
                checkout_session
            },{
                status:"paid"
            })

            return sanitizeEntity(updateOrder, { model: strapi.models.order})
        } else {
            ctx.throw(400, "The payment wasn´t succesful, please retry or call support")
        }
    }

};
